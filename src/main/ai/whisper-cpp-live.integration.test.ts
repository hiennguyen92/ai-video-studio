import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'
import { extractAudioForTranscription } from '../media/audio-extraction'
import { resolveWhisperBinary, whisperCppSttAdapter } from './whisper-cpp-stt-adapter'

/**
 * Kiểm thử CHẠY THẬT whisper.cpp.
 *
 * Cần một file model ggml; chỉ tới nó bằng `WHISPER_MODEL_PATH`:
 *
 *   brew install whisper-cpp
 *   curl -L -o ~/ggml-medium.bin \
 *     https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin
 *   WHISPER_MODEL_PATH=~/ggml-medium.bin npx vitest run src/main/ai/whisper-cpp-live
 *
 * Không có biến đó thì cả nhóm bị bỏ qua, nên máy khác vẫn chạy đủ test suite.
 *
 * Âm thanh dùng để thử được tổng hợp tại chỗ bằng ffmpeg, không phải giọng người,
 * nên nhóm này KIỂM CHỨNG HỢP ĐỒNG (chạy được, ra JSON đúng hình dạng, timestamp
 * hợp lệ) chứ không đánh giá độ chính xác nhận dạng.
 */

const execFileAsync = promisify(execFile)
const modelPath = process.env.WHISPER_MODEL_PATH
const live = modelPath ? describe : describe.skip

let workDir: string
let audioPath: string

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-whisper-live-'))
  const sourcePath = join(workDir, 'nguon.wav')
  audioPath = join(workDir, 'phien-am.wav')

  const { ffmpegPath } = resolveFfmpegBinaries()
  // Vài giây âm thanh có biến thiên để whisper có gì đó để xử lý.
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=200:duration=4:sample_rate=44100',
    '-ac',
    '2',
    sourcePath
  ])

  await extractAudioForTranscription({
    sourcePath,
    sourceInUs: 0,
    durationUs: 4_000_000,
    outputPath: audioPath
  })
}, 120_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

function context(): AdapterContext {
  return {
    apiKey: '',
    config: { modelPath: modelPath ?? '' },
    signal: new AbortController().signal
  }
}

live('whisper.cpp — chạy thật', () => {
  it('tìm được binary whisper-cli đã cài', async () => {
    const binary = await resolveWhisperBinary()
    expect(binary.length).toBeGreaterThan(0)
  })

  it('kiểm tra sẵn sàng báo đủ binary và model', async () => {
    const result = await whisperCppSttAdapter.testConnection(context())
    expect(result.ok).toBe(true)
    expect(result.details).toContain('whisper-cli')
  }, 30_000)

  it('báo lỗi rõ ràng khi model không tồn tại', async () => {
    const result = await whisperCppSttAdapter.testConnection({
      apiKey: '',
      config: { modelPath: '/khong/ton/tai/ggml.bin' },
      signal: new AbortController().signal
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Không đọc được file model')
  })

  it('phiên âm chạy được và trả về hình dạng adapter mong đợi', async () => {
    const progressValues: number[] = []
    const result = await whisperCppSttAdapter.transcribe(
      { ...context(), onProgress: (ratio) => progressValues.push(ratio) },
      {
        model: modelPath as string,
        audioPath,
        language: 'vi',
        wantWordTimestamps: true,
        wantSpeakerLabels: false
      }
    )

    expect(result.language).toBeTruthy()
    expect(Array.isArray(result.segments)).toBe(true)

    // Mọi segment phải có mốc thời gian hợp lệ và tăng dần.
    for (const segment of result.segments) {
      expect(segment.endUs).toBeGreaterThanOrEqual(segment.startUs)
      expect(segment.startUs).toBeGreaterThanOrEqual(0)
      expect(typeof segment.text).toBe('string')
      for (const word of segment.words ?? []) {
        expect(word.endUs).toBeGreaterThanOrEqual(word.startUs)
        // Từ đã ghép không được còn khoảng trắng ở hai đầu.
        expect(word.text).toBe(word.text.trim())
      }
    }

    // Tiến trình phải là số THẬT do whisper.cpp báo, tăng dần tới 1.
    expect(progressValues.length).toBeGreaterThan(0)
    expect(Math.max(...progressValues)).toBeCloseTo(1, 1)
  }, 300_000)

  it('huỷ giữa chừng dừng hẳn tiến trình con', async () => {
    const controller = new AbortController()
    const attempt = whisperCppSttAdapter.transcribe(
      { apiKey: '', config: { modelPath: modelPath ?? '' }, signal: controller.signal },
      {
        model: modelPath as string,
        audioPath,
        language: 'vi',
        wantWordTimestamps: true,
        wantSpeakerLabels: false
      }
    )
    controller.abort()
    await expect(attempt).rejects.toThrow(/huỷ/i)
  }, 120_000)
})
