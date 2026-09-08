import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Micros } from '../../shared/domain/time-units'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

/**
 * Cắt footage thô thành các CÚ MÁY, và trích một ảnh đại diện cho mỗi cú.
 *
 * Vì sao cần: dựng theo transcript chỉ chạy được khi footage có tiếng nói. Video
 * quay review sản phẩm thường KHÔNG có tiếng — lúc đó transcript rỗng và agent
 * không có gì để đọc. Nó phải nhìn hình, và muốn nhìn thì trước hết phải biết
 * video gồm những cú máy nào.
 *
 * Cách làm: bộ lọc `select='gt(scene,…)'` của ffmpeg chấm điểm khác biệt giữa hai
 * khung liền nhau, rồi `metadata=print` in ra mốc thời gian vượt ngưỡng. Định
 * dạng đầu ra được xác minh bằng cách CHẠY THẬT, không lấy theo trí nhớ:
 *
 *     frame:0    pts:30720   pts_time:2
 *     lavfi.scene_score=0.400000
 */

const execFileAsync = promisify(execFile)

/**
 * Ngưỡng khác biệt để tính là chuyển cảnh.
 *
 * 0,3 là mức thường dùng: thấp hơn thì một cú lia máy nhanh cũng bị cắt làm đôi,
 * cao hơn thì bỏ sót những lần chuyển cảnh mềm.
 */
export const DEFAULT_SCENE_THRESHOLD = 0.3

/**
 * Cú máy ngắn hơn mức này bị gộp vào cú trước.
 *
 * Footage thật hay có chớp sáng, lóe đèn, hoặc một khung mờ khi lia máy — mỗi
 * thứ đó sinh một "cảnh" dài vài phần trăm giây mà không ai gọi là một cú máy.
 */
export const MIN_SHOT_DURATION_US = 400_000

export interface DetectedShot {
  index: number
  startUs: Micros
  endUs: Micros
  /** Ảnh đại diện lấy ở giữa cú máy, để agent xem được mà chọn cảnh. */
  framePath?: string
}

/** Đọc mốc chuyển cảnh (giây) từ đầu ra của `metadata=print`. */
export function parseSceneChangeSeconds(output: string): number[] {
  const times: number[] = []

  for (const line of output.split('\n')) {
    const match = /pts_time:([0-9.]+)/.exec(line)
    if (!match) continue
    const seconds = Number(match[1])
    if (Number.isFinite(seconds) && seconds > 0) times.push(seconds)
  }

  return [...new Set(times)].sort((left, right) => left - right)
}

/**
 * Biến các mốc chuyển cảnh thành danh sách cú máy.
 *
 * Cú máy đầu luôn bắt đầu ở 0 — ffmpeg không báo mốc đó vì không có khung nào
 * trước nó để so sánh.
 */
export function buildShots(
  boundarySeconds: number[],
  durationUs: Micros,
  minShotUs = MIN_SHOT_DURATION_US
): DetectedShot[] {
  if (durationUs <= 0) return []

  const cuts = boundarySeconds
    .map((seconds) => Math.round(seconds * 1_000_000))
    .filter((us) => us > 0 && us < durationUs)

  const starts: Micros[] = [0]
  for (const cut of cuts) {
    // Gộp cú quá ngắn vào cú trước thay vì tạo một mảnh vụn.
    if (cut - (starts.at(-1) as number) >= minShotUs) starts.push(cut)
  }

  const shots: DetectedShot[] = []
  for (const [index, startUs] of starts.entries()) {
    const endUs = starts[index + 1] ?? durationUs
    if (endUs - startUs <= 0) continue
    shots.push({ index: shots.length, startUs, endUs })
  }

  // Cú cuối quá ngắn thì nhập vào cú trước, cùng lý do như trên.
  const last = shots.at(-1)
  if (shots.length > 1 && last && last.endUs - last.startUs < minShotUs) {
    shots[shots.length - 2].endUs = last.endUs
    shots.pop()
  }

  return shots
}

/** Chạy ffmpeg để lấy mốc chuyển cảnh của một file. */
export async function detectSceneChanges(
  sourcePath: string,
  threshold = DEFAULT_SCENE_THRESHOLD
): Promise<number[]> {
  const { ffmpegPath } = resolveFfmpegBinaries()

  const { stdout } = await execFileAsync(
    ffmpegPath,
    [
      '-v',
      'info',
      '-i',
      sourcePath,
      '-filter_complex',
      `select='gt(scene,${threshold})',metadata=print:file=-`,
      // Bỏ tiếng và không ghi file: chỉ cần phần siêu dữ liệu in ra.
      '-an',
      '-f',
      'null',
      '-'
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  )

  return parseSceneChangeSeconds(stdout)
}

/**
 * Trích ảnh đại diện cho từng cú máy.
 *
 * Lấy ở GIỮA cú, không lấy khung đầu: khung ngay sau chỗ cắt hay dính mờ chuyển
 * động hoặc còn đang trong hiệu ứng, nhìn không ra nội dung.
 */
export async function extractShotFrames(
  sourcePath: string,
  shots: DetectedShot[],
  outputDir: string
): Promise<DetectedShot[]> {
  const { ffmpegPath } = resolveFfmpegBinaries()
  await mkdir(outputDir, { recursive: true })

  const withFrames: DetectedShot[] = []
  for (const shot of shots) {
    const middleSeconds = (shot.startUs + (shot.endUs - shot.startUs) / 2) / 1_000_000
    const framePath = join(outputDir, `shot-${String(shot.index).padStart(3, '0')}.jpg`)

    try {
      await execFileAsync(ffmpegPath, [
        '-v',
        'error',
        '-y',
        '-ss',
        middleSeconds.toFixed(3),
        '-i',
        sourcePath,
        '-frames:v',
        '1',
        // Thu nhỏ: agent chỉ cần nhận ra nội dung, không cần độ phân giải gốc.
        '-vf',
        'scale=480:-2',
        '-q:v',
        '4',
        framePath
      ])
      withFrames.push({ ...shot, framePath })
    } catch {
      // Một cú trích hỏng không nên làm hỏng cả lượt phát hiện.
      withFrames.push({ ...shot })
    }
  }

  return withFrames
}
