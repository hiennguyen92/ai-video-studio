import type { Micros } from '../../shared/domain/time-units'
import type {
  SilenceDetectionRequest,
  SilenceDetectionResult
} from '../../shared/ipc/silence-detection-types'
import { analyseAudioLevels } from './audio-level-analysis'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { runTrackedProcess } from './ffmpeg-process-registry'

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

/** Khi không đo được (đoạn quá ngắn, không có mẫu nào): mức hợp giọng thu gần. */
const FALLBACK_THRESHOLD_DB = -35

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

/**
 * Ngưỡng tự đo, hoặc ngưỡng mặc định nếu bước đo hỏng. Đo chỉ để chọn ngưỡng cho
 * tốt hơn — nó hỏng (file lạ, bộ lọc astats không đọc được) thì vẫn tìm khoảng
 * lặng được với ngưỡng mặc định, không lý do gì làm hỏng cả thao tác.
 */
async function measuredThreshold(request: SilenceDetectionRequest): Promise<number> {
  try {
    const levels = await analyseAudioLevels(request.sourcePath, request.startUs, request.endUs)
    return levels?.thresholdDb ?? FALLBACK_THRESHOLD_DB
  } catch (error) {
    // Bị huỷ vì app đang thoát thì dừng hẳn, đừng chạy tiếp lượt dò.
    if (error instanceof Error && error.name === 'AbortError') throw error
    return FALLBACK_THRESHOLD_DB
  }
}

/** Chạy ffmpeg trên đoạn `[startUs, endUs)` của file nguồn. Mốc trả về tính trên trục NGUỒN. */
export async function detectSilences(
  request: SilenceDetectionRequest
): Promise<SilenceDetectionResult> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const durationSeconds = (request.endUs - request.startUs) / 1_000_000
  const automatic = request.noiseDb === undefined
  // Đoạn rỗng: không có gì để đo, và ffmpeg nhận `-t 0` là đọc HẾT file.
  if (durationSeconds <= 0) {
    return { intervals: [], thresholdDb: request.noiseDb ?? FALLBACK_THRESHOLD_DB, automatic }
  }
  const thresholdDb = request.noiseDb ?? (await measuredThreshold(request))

  // `silencedetect` ghi ra stderr ở mức info; tiến trình trả stderr đầy đủ khi thoát 0.
  const { stderr } = await runTrackedProcess(
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
      `silencedetect=noise=${thresholdDb}dB:d=${request.minSilenceUs / 1_000_000}`,
      '-f',
      'null',
      '-'
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  )

  const intervals = parseSilenceOutput(stderr, durationSeconds).map(([from, to]) => ({
    startUs: request.startUs + toMicros(from),
    endUs: request.startUs + toMicros(to)
  }))
  return { intervals, thresholdDb, automatic }
}
