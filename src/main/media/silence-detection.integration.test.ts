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
    const silences = await detectSilences({
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
    const silences = await detectSilences({
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
    ).toEqual([])
  })
})

describe('parseSilenceOutput', () => {
  it('silence_start không có silence_end theo sau thì im tới hết đoạn', () => {
    expect(parseSilenceOutput('[silencedetect @ 0x1] silence_start: 3.5\n', 5)).toEqual([[3.5, 5]])
  })
})
