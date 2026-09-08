import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { probeMediaFile } from './media-probe'
import {
  TRANSCRIPTION_SAMPLE_RATE,
  extractAudioForTranscription,
  mixAudioForTranscription
} from './audio-extraction'

/**
 * Kiểm thử trích audio để phiên âm — chạy ffmpeg thật rồi soi file kết quả.
 *
 * Định dạng ở đây không phải chuyện thẩm mỹ: sai tần số lấy mẫu hoặc sai số kênh
 * thì whisper.cpp cho ra transcript rác chứ không báo lỗi, nên phải kiểm bằng ffprobe.
 */

const execFileAsync = promisify(execFile)

let workDir: string
let videoPath: string
let musicPath: string

beforeAll(async () => {
  const { ffmpegPath } = resolveFfmpegBinaries()
  workDir = await mkdtemp(join(tmpdir(), 'avs-audio-extract-'))
  videoPath = join(workDir, 'canh-quay.mp4')
  musicPath = join(workDir, 'nhac.wav')

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=25:duration=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=10:sample_rate=48000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    videoPath
  ])
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=10:sample_rate=44100',
    musicPath
  ])
}, 180_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('extractAudioForTranscription', () => {
  it('cho ra WAV 16 kHz một kênh — đúng thứ whisper.cpp cần', async () => {
    const outputPath = join(workDir, 'trich.wav')
    await extractAudioForTranscription({
      sourcePath: videoPath,
      sourceInUs: 2_000_000,
      durationUs: 3_000_000,
      outputPath
    })

    const { probe } = await probeMediaFile(outputPath)
    expect(probe.audioSampleRate).toBe(TRANSCRIPTION_SAMPLE_RATE)
    expect(probe.audioChannels).toBe(1)
    expect(probe.hasVideo).toBe(false)
  }, 60_000)

  it('cắt đúng khoảng thời gian được yêu cầu', async () => {
    const outputPath = join(workDir, 'trich-3s.wav')
    await extractAudioForTranscription({
      sourcePath: videoPath,
      sourceInUs: 1_000_000,
      durationUs: 3_000_000,
      outputPath
    })

    const { probe } = await probeMediaFile(outputPath)
    // Cắt theo mẫu nên sai lệch phải rất nhỏ; nếu tới hàng trăm mili giây thì
    // -ss đã bị đặt sai vị trí và mọi timestamp transcript sẽ trôi.
    expect(probe.durationUs).toBeGreaterThan(2_950_000)
    expect(probe.durationUs).toBeLessThan(3_050_000)
  }, 60_000)

  it('từ chối khoảng thời gian rỗng thay vì tạo file vô nghĩa', async () => {
    await expect(
      extractAudioForTranscription({
        sourcePath: videoPath,
        sourceInUs: 0,
        durationUs: 0,
        outputPath: join(workDir, 'rong.wav')
      })
    ).rejects.toThrow(/lớn hơn 0/)
  })
})

describe('mixAudioForTranscription', () => {
  it('trộn nhiều nguồn theo đúng vị trí thời gian', async () => {
    const outputPath = join(workDir, 'tron.wav')
    await mixAudioForTranscription(
      [
        { path: videoPath, sourceInUs: 0, durationUs: 2_000_000, offsetUs: 0 },
        { path: musicPath, sourceInUs: 0, durationUs: 2_000_000, offsetUs: 3_000_000 }
      ],
      5_000_000,
      outputPath
    )

    const { probe } = await probeMediaFile(outputPath)
    expect(probe.audioSampleRate).toBe(TRANSCRIPTION_SAMPLE_RATE)
    expect(probe.audioChannels).toBe(1)
    // Nguồn thứ hai bắt đầu ở giây 3 và dài 2 giây nên tổng là 5 giây.
    expect(probe.durationUs).toBeGreaterThan(4_900_000)
    expect(probe.durationUs).toBeLessThan(5_100_000)
  }, 60_000)

  it('báo lỗi rõ ràng khi khoảng chọn không có nguồn audio nào', async () => {
    await expect(
      mixAudioForTranscription([], 1_000_000, join(workDir, 'khong-co.wav'))
    ).rejects.toThrow(/Không có nguồn audio/)
  })
})
