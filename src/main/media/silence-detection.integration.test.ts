import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { detectSilences, parseSilenceOutput } from './silence-detection'

/**
 * Dò khoảng lặng bằng ffmpeg THẬT trên file sine 2 s – im 1,5 s – sine 2 s.
 * Chỉ bản thật mới lộ được chuyện mốc tính từ `-ss` chứ không từ đầu file.
 */

const execFileAsync = promisify(execFile)
let workDir = ''
let file = ''

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-silence-'))
  file = join(workDir, 'loi-noi.wav')
  await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-filter_complex',
    '[1]atrim=duration=1.5[s];[0][s][2]concat=n=3:v=0:a=1',
    file
  ])
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const request = { noiseDb: -35, minSilenceUs: 500_000 }

describe('detectSilences', () => {
  it('trả khoảng lặng trên trục NGUỒN, kể cả khi chỉ dò một đoạn giữa file', async () => {
    const { intervals: silences } = await detectSilences({
      ...request,
      sourcePath: file,
      startUs: 500_000,
      endUs: 4_500_000
    })
    expect(silences).toHaveLength(1)
    expect(silences[0].startUs).toBeGreaterThan(1_950_000)
    expect(silences[0].startUs).toBeLessThan(2_050_000)
    expect(silences[0].endUs).toBeGreaterThan(3_450_000)
    expect(silences[0].endUs).toBeLessThan(3_550_000)
  })

  it('im kéo tới hết đoạn dò thì đóng ở cuối đoạn', async () => {
    const { intervals: silences } = await detectSilences({
      ...request,
      sourcePath: file,
      startUs: 1_000_000,
      endUs: 3_000_000
    })
    expect(silences).toHaveLength(1)
    expect(silences[0].endUs).toBe(3_000_000)
  })

  it('im ngắn hơn mức tối thiểu thì bỏ qua', async () => {
    expect(
      await detectSilences({
        ...request,
        minSilenceUs: 2_000_000,
        sourcePath: file,
        startUs: 0,
        endUs: 5_500_000
      })
    ).toMatchObject({ intervals: [], thresholdDb: -35, automatic: false })
  })
})

describe('ngưỡng tự đo', () => {
  it('phòng ồn: -35 dB cố định không bắt được gì, tự đo thì bắt đúng hai khoảng lặng', async () => {
    // Tiếng nói 1–2 s và 3–4 s trên nhiễu trắng: đỉnh nhiễu -30,5 dB, trên -35 dB.
    const noisy = join(workDir, 'phong-on.wav')
    await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='0.4*sin(2*PI*300*t)*(between(t,1,2)+between(t,3,4))':s=48000:d=5",
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=white:amplitude=0.03:sample_rate=48000:duration=5',
      '-filter_complex',
      '[0][1]amix=inputs=2:normalize=0',
      noisy
    ])
    const range = { sourcePath: noisy, startUs: 0, endUs: 5_000_000, minSilenceUs: 500_000 }

    const fixed = await detectSilences({ ...range, noiseDb: -35 })
    expect(fixed.intervals).toEqual([])

    const automatic = await detectSilences(range)
    expect(automatic.automatic).toBe(true)
    // Đỉnh nhiễu đo được -30,5 dB, đỉnh lời nói -7,3 dB: ngưỡng phải nằm giữa.
    expect(automatic.thresholdDb).toBeGreaterThan(-30)
    expect(automatic.thresholdDb).toBeLessThan(-8)
    expect(automatic.intervals.length).toBeGreaterThanOrEqual(2)
    // Không được ăn vào lời nói: khoảng lặng giữa hai câu nằm trong 2–3 s.
    const middle = automatic.intervals.find(
      (item) => item.startUs > 1_500_000 && item.startUs < 2_500_000
    )!
    expect(middle.startUs).toBeGreaterThanOrEqual(1_950_000)
    expect(middle.endUs).toBeLessThanOrEqual(3_050_000)
  })
})

describe('parseSilenceOutput', () => {
  it('silence_start không có silence_end theo sau thì im tới hết đoạn', () => {
    expect(parseSilenceOutput('[silencedetect @ 0x1] silence_start: 3.5\n', 5)).toEqual([[3.5, 5]])
  })
})
