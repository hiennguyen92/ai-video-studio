import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Micros } from '../../shared/domain/time-units'
import type {
  SilenceDetectionRequest,
  SilenceInterval
} from '../../shared/ipc/silence-detection-types'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

/**
 * Tìm khoảng lặng trong tiếng của một đoạn file nguồn, bằng `silencedetect` của
 * ffmpeg.
 *
 * Dò trên TIẾNG chứ không trên transcript: chạy được cả khi chưa phiên âm, và bắt
 * được những chỗ im mà whisper nuốt vào đầu câu kế. Định dạng đầu ra xác minh
 * bằng cách CHẠY THẬT với file sine–im–sine, không theo trí nhớ:
 *
 *     [silencedetect @ 0x…] silence_start: 1.49995
 *     [silencedetect @ 0x…] silence_end: 3.00007 | silence_duration: 1.50011
 *
 * Mốc tính TỪ điểm `-ss`, không phải từ đầu file — nên phải cộng lại `startUs`.
 */

const execFileAsync = promisify(execFile)

/**
 * Đọc khoảng lặng (giây, tính từ đầu đoạn đã dò) từ stderr của ffmpeg.
 *
 * Một `silence_start` không có `silence_end` theo sau nghĩa là im tới hết đoạn.
 * Bản ffmpeg đi kèm tự đóng khoảng ở cuối, nhưng bản cũ thì không — thiếu nhánh
 * này thì đoạn im cuối clip lặng lẽ không bị cắt.
 */
export function parseSilenceOutput(
  output: string,
  durationSeconds: number
): Array<[number, number]> {
  const intervals: Array<[number, number]> = []
  let openStart: number | null = null

  for (const line of output.split('\n')) {
    const start = /silence_start:\s*(-?[0-9.]+)/.exec(line)
    if (start) {
      openStart = Math.max(0, Number(start[1]))
      continue
    }
    const end = /silence_end:\s*([0-9.]+)/.exec(line)
    if (end && openStart !== null) {
      intervals.push([openStart, Math.min(durationSeconds, Number(end[1]))])
      openStart = null
    }
  }
  if (openStart !== null && openStart < durationSeconds)
    intervals.push([openStart, durationSeconds])
  return intervals.filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from)
}

const toMicros = (seconds: number): Micros => Math.round(seconds * 1_000_000)

/** Chạy ffmpeg trên đoạn `[startUs, endUs)` của file nguồn. Mốc trả về tính trên trục NGUỒN. */
export async function detectSilences(request: SilenceDetectionRequest): Promise<SilenceInterval[]> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const durationSeconds = (request.endUs - request.startUs) / 1_000_000
  if (durationSeconds <= 0) return []

  // `silencedetect` ghi ra stderr ở mức info; `execFile` trả stderr đầy đủ khi thoát 0.
  const { stderr } = await execFileAsync(
    ffmpegPath,
    [
      '-hide_banner',
      '-nostats',
      '-ss',
      String(request.startUs / 1_000_000),
      '-t',
      String(durationSeconds),
      '-i',
      request.sourcePath,
      '-vn',
      '-af',
      `silencedetect=noise=${request.noiseDb}dB:d=${request.minSilenceUs / 1_000_000}`,
      '-f',
      'null',
      '-'
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  )

  return parseSilenceOutput(stderr, durationSeconds).map(([from, to]) => ({
    startUs: request.startUs + toMicros(from),
    endUs: request.startUs + toMicros(to)
  }))
}
