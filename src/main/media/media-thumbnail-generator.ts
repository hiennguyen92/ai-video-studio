import { execFile } from 'node:child_process'
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

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
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

  return { frameCount: safeFrameCount, tileWidth: FILMSTRIP_TILE_WIDTH, tileHeight: 0 }
}
