import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { microsToSeconds } from '../../shared/domain/time-units'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

const execFileAsync = promisify(execFile)

/**
 * Sinh ảnh đại diện và dải filmstrip cho timeline.
 *
 * Filmstrip là MỘT ảnh sprite ngang chứa nhiều frame thay vì nhiều file rời:
 * timeline chỉ cần tải một ảnh, và trình duyệt chỉ cần dịch background-position
 * khi cuộn, nên cuộn timeline không bị giật vì hàng trăm request ảnh.
 */

const THUMBNAIL_WIDTH = 320
const FILMSTRIP_TILE_WIDTH = 160

export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  atUs: number
): Promise<void> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    // -ss trước -i là seek nhanh (theo keyframe) — đủ chính xác cho ảnh đại diện.
    '-ss',
    microsToSeconds(Math.max(0, atUs)).toFixed(3),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${THUMBNAIL_WIDTH}:-2:flags=bicubic`,
    '-q:v',
    '4',
    outputPath
  ])
}

export interface FilmstripResult {
  frameCount: number
  tileWidth: number
  tileHeight: number
}

/**
 * Sprite ngang gồm `frameCount` frame trải đều trên toàn bộ thời lượng.
 */
export async function generateFilmstrip(
  inputPath: string,
  outputPath: string,
  durationUs: number,
  frameCount = 40
): Promise<FilmstripResult> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const durationSeconds = microsToSeconds(durationUs)
  const safeFrameCount = Math.max(1, Math.min(frameCount, 200))
  // Lấy mẫu đều: fps = số frame mong muốn / tổng số giây.
  const sampleFps = durationSeconds > 0 ? safeFrameCount / durationSeconds : 1

  const run = async (keyframesOnly: boolean): Promise<void> => {
    await execFileAsync(ffmpegPath, [
      '-v',
      'error',
      '-y',
      // Chỉ giải mã keyframe. Video 4K dài 155 giây đo được 27,4 giây khi giải mã
      // hết, còn 6,3 giây khi chỉ lấy keyframe — nhanh hơn 4,3 lần, và filmstrip
      // chính xác tới keyframe là quá đủ cho việc rê chuột xem đoạn nào có gì.
      ...(keyframesOnly ? ['-skip_frame', 'nokey'] : []),
      '-i',
      inputPath,
      '-vf',
      `fps=${sampleFps.toFixed(6)},scale=${FILMSTRIP_TILE_WIDTH}:-2:flags=bilinear,tile=${safeFrameCount}x1`,
      '-frames:v',
      '1',
      '-q:v',
      '5',
      outputPath
    ])
  }

  // Thử đường nhanh trước rồi LÙI, thay vì đoán trước bằng một ngưỡng thời lượng.
  //
  // Clip ít keyframe không đủ frame để xếp kín ô: đo trên một clip 6 giây chỉ có
  // ĐÚNG MỘT keyframe, `tile` không ghép nổi và ffmpeg không ghi ra file nào —
  // mà vẫn thoát với mã 0. Nên phải kiểm bằng sự tồn tại của file, không kiểm
  // bằng mã thoát.
  //
  // Lùi về giải mã đầy đủ không đắt ở đúng những file phải lùi: ít keyframe gần
  // như luôn đi cùng clip ngắn, mà clip ngắn thì giải mã hết cũng chỉ vài phần
  // trăm giây.
  await run(true)
  if (!(await hasContent(outputPath))) await run(false)

  return { frameCount: safeFrameCount, tileWidth: FILMSTRIP_TILE_WIDTH, tileHeight: 0 }
}

/** File có tồn tại và có nội dung không. */
async function hasContent(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}
