import { execFile } from 'node:child_process'
import { rename, rm } from 'node:fs/promises'
import { promisify } from 'node:util'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'

/**
 * Chuẩn hoá độ to của file đã xuất về một mức LUFS, bằng `loudnorm` HAI LƯỢT.
 *
 * Vì sao cần: YouTube, TikTok, Spotify tự hạ file to hơn mức của họ (~-14 LUFS)
 * và để nguyên file nhỏ hơn — video nhỏ tiếng sẽ nhỏ tiếng hẳn so với video bên
 * cạnh. Không ai tự canh được mức này bằng tai.
 *
 * Vì sao hai lượt: một lượt thì `loudnorm` chỉnh ĐỘNG theo cửa sổ trượt, nghe ra
 * tiếng nhạc "bơm" lên xuống. Lượt đầu đo cả file, lượt hai áp một mức tăng
 * THẲNG (`linear=true`) theo số đo — đúng cách tài liệu ffmpeg khuyên.
 *
 * Chạy SAU khi dựng xong, trên file MP4, và chép nguyên luồng hình: dùng được cho
 * cả hai bộ dựng mà không phải sửa bộ nào, và hình không bị mã hoá lại lần hai.
 *
 * Định dạng JSON đọc từ lần chạy thật; file im hoàn toàn cho `"input_i": "-inf"`,
 * file không có tiếng thì không in JSON nào.
 */

const execFileAsync = promisify(execFile)

/** Đỉnh thật tối đa (dBTP): chừa -1,5 dB để bộ mã hoá AAC không làm vỡ tiếng. */
const TRUE_PEAK_DB = -1.5
const LOUDNESS_RANGE = 11
/** Dưới mức này coi như im: kéo nó lên -14 LUFS chỉ là khuếch đại tiếng xì nền. */
const SILENCE_FLOOR_LUFS = -70

export interface LoudnessMeasurement {
  inputI: number
  inputTp: number
  inputLra: number
  inputThresh: number
  targetOffset: number
}

/** Lấy khối JSON cuối cùng mà `loudnorm` in ra stderr. `null` khi không có. */
export function parseLoudnormJson(output: string): LoudnessMeasurement | null {
  const start = output.lastIndexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    const raw = JSON.parse(output.slice(start, end + 1)) as Record<string, string>
    // ffmpeg in "-inf" cho file im; `Number("-inf")` là NaN chứ không phải -Infinity.
    const read = (key: string): number =>
      raw[key] === '-inf' ? Number.NEGATIVE_INFINITY : Number(raw[key])
    return {
      inputI: read('input_i'),
      inputTp: read('input_tp'),
      inputLra: read('input_lra'),
      inputThresh: read('input_thresh'),
      targetOffset: read('target_offset')
    }
  } catch {
    return null
  }
}

/** Đo độ to của file. `null` khi file không có luồng tiếng. */
export async function measureLoudness(
  path: string,
  targetLufs: number,
  signal?: AbortSignal
): Promise<LoudnessMeasurement | null> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const args = [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-vn',
    '-af',
    `loudnorm=I=${targetLufs}:TP=${TRUE_PEAK_DB}:LRA=${LOUDNESS_RANGE}:print_format=json`,
    '-f',
    'null',
    '-'
  ]
  try {
    const { stderr } = await execFileAsync(ffmpegPath, args, {
      maxBuffer: 16 * 1024 * 1024,
      signal
    })
    return parseLoudnormJson(stderr)
  } catch (error) {
    if (signal?.aborted) throw error
    // File không có tiếng: ffmpeg thoát lỗi "does not contain any stream".
    const stderr = (error as { stderr?: string }).stderr ?? ''
    if (/does not contain any stream|matches no streams/i.test(stderr)) return null
    throw error
  }
}

export type LoudnessOutcome =
  | { status: 'normalized'; measuredLufs: number }
  | { status: 'skipped'; reason: 'no-audio' | 'silent' }

/**
 * Đo rồi chuẩn hoá `path` tại chỗ: ghi ra file tạm cạnh nó, đổi tên đè lên khi
 * xong. Hỏng hay bị huỷ giữa chừng thì file đã xuất vẫn nguyên như trước.
 */
export async function normalizeLoudnessInPlace(
  path: string,
  targetLufs: number,
  sampleRate: number,
  signal?: AbortSignal
): Promise<LoudnessOutcome> {
  const measured = await measureLoudness(path, targetLufs, signal)
  if (!measured) return { status: 'skipped', reason: 'no-audio' }
  if (!Number.isFinite(measured.inputI) || measured.inputI < SILENCE_FLOOR_LUFS) {
    return { status: 'skipped', reason: 'silent' }
  }

  const { ffmpegPath } = resolveFfmpegBinaries()
  const tempPath = `${path}.loudnorm.mp4`
  const filter = [
    `loudnorm=I=${targetLufs}`,
    `TP=${TRUE_PEAK_DB}`,
    `LRA=${LOUDNESS_RANGE}`,
    `measured_I=${measured.inputI}`,
    `measured_TP=${measured.inputTp}`,
    `measured_LRA=${measured.inputLra}`,
    `measured_thresh=${measured.inputThresh}`,
    `offset=${measured.targetOffset}`,
    'linear=true'
  ].join(':')

  try {
    await execFileAsync(
      ffmpegPath,
      [
        '-v',
        'error',
        '-y',
        '-i',
        path,
        '-map',
        '0:v?',
        '-map',
        '0:a',
        '-c:v',
        'copy',
        '-af',
        filter,
        // `loudnorm` đẩy tần số lấy mẫu lên 192 kHz ở đầu ra; không đặt lại thì
        // file AAC mang một tần số lạ mà nhiều trình phát xử lý kém.
        '-ar',
        String(sampleRate),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        tempPath
      ],
      { maxBuffer: 16 * 1024 * 1024, signal }
    )
    await rename(tempPath, path)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
  return { status: 'normalized', measuredLufs: measured.inputI }
}
