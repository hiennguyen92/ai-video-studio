import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Micros } from '../../shared/domain/time-units'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

/**
 * Tự tìm ngưỡng im cho `silencedetect`, thay cho con số -35 dB cố định.
 *
 * Vì sao cần: `silencedetect` so TỪNG MẪU với ngưỡng, tức là so theo ĐỈNH, không
 * theo mức trung bình. Phòng yên tĩnh thì đỉnh nhiễu nằm quanh -60 dB và -35 dB
 * là thừa; phòng ồn có quạt thì đỉnh nhiễu lên tới -22 dB và -35 dB không bắt
 * được khoảng lặng nào — người dùng bấm "dò" và nhận về con số 0.
 *
 * Cách làm: đo đỉnh của từng cửa sổ 50 ms, lấy phân vị thấp làm NỀN NHIỄU và phân
 * vị cao làm LỜI NÓI, đặt ngưỡng ở khoảng một phần ba từ nền lên. Định dạng đầu
 * ra đọc từ lần chạy thật:
 *
 *     lavfi.astats.Overall.Peak_level=-21.969270
 *     lavfi.astats.Overall.Peak_level=-inf        (im tuyệt đối)
 */

const execFileAsync = promisify(execFile)

/** Im tuyệt đối (`-inf`) quy về mức này để còn tính phân vị được. */
const DIGITAL_SILENCE_DB = -120
/** Nền thấp hơn mức này thì coi như bằng nó — tránh ngưỡng -110 dB vô nghĩa. */
const FLOOR_CLAMP_DB = -90
/**
 * Lời nói phải to hơn nền ít nhất chừng này mới gọi là CÓ khoảng lặng. Dưới
 * mức đó (nói liền, không nghỉ) thì phân vị thấp rơi vào chữ nói nhỏ, và một
 * ngưỡng đặt theo nó sẽ cắt mất âm tiết.
 */
const MIN_SPREAD_DB = 10

export interface AudioLevelSummary {
  /** Đỉnh nhiễu nền: phân vị 10 của đỉnh các cửa sổ. */
  noiseFloorDb: number
  /** Đỉnh lời nói: phân vị 90. */
  speechDb: number
  /** Ngưỡng đề xuất cho `silencedetect`. */
  thresholdDb: number
}

/** Đỉnh (dB) của từng cửa sổ, đọc từ đầu ra `ametadata=print`. */
export function parseWindowPeaks(output: string): number[] {
  const peaks: number[] = []
  for (const match of output.matchAll(/Peak_level=(-?inf|-?[0-9.]+)/g)) {
    const value = match[1].endsWith('inf') ? DIGITAL_SILENCE_DB : Number(match[1])
    if (Number.isFinite(value)) peaks.push(Math.max(DIGITAL_SILENCE_DB, value))
  }
  return peaks
}

function percentile(sorted: number[], ratio: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]
}

/** Ngưỡng từ phân bố đỉnh. `null` khi không có dữ liệu. */
export function suggestSilenceThreshold(peaks: readonly number[]): AudioLevelSummary | null {
  if (peaks.length === 0) return null
  const sorted = [...peaks].sort((left, right) => left - right)
  const noiseFloorDb = Math.max(FLOOR_CLAMP_DB, percentile(sorted, 0.1))
  const speechDb = percentile(sorted, 0.9)
  const spread = speechDb - noiseFloorDb

  // Không có khoảng lặng rõ ràng: đặt ngưỡng DƯỚI nền để không cắt gì cả.
  const thresholdDb =
    spread < MIN_SPREAD_DB ? noiseFloorDb - 3 : noiseFloorDb + Math.max(4, spread * 0.35)

  const round = (value: number): number => Math.round(value * 10) / 10
  return {
    noiseFloorDb: round(noiseFloorDb),
    speechDb: round(speechDb),
    thresholdDb: round(Math.min(-10, Math.max(-80, thresholdDb)))
  }
}

/** Đo đoạn `[startUs, endUs)` của file nguồn. */
export async function analyseAudioLevels(
  sourcePath: string,
  startUs: Micros,
  endUs: Micros
): Promise<AudioLevelSummary | null> {
  const { stdout } = await execFileAsync(
    resolveFfmpegBinaries().ffmpegPath,
    [
      '-hide_banner',
      '-v',
      'error',
      '-ss',
      String(startUs / 1_000_000),
      '-t',
      String((endUs - startUs) / 1_000_000),
      '-i',
      sourcePath,
      '-vn',
      '-af',
      // Cửa sổ 2400 mẫu ở 48 kHz = 50 ms: đủ ngắn để bắt khoảng nghỉ giữa hai
      // câu, đủ dài để một tiếng tách không thành một "câu nói".
      'aresample=48000,asetnsamples=n=2400:p=0,astats=metadata=1:reset=1,' +
        'ametadata=print:key=lavfi.astats.Overall.Peak_level:file=-',
      '-f',
      'null',
      '-'
    ],
    { maxBuffer: 64 * 1024 * 1024 }
  )
  return suggestSilenceThreshold(parseWindowPeaks(stdout))
}
