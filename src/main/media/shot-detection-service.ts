import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DetectedShotDto } from '../../shared/ipc/ipc-contract'
import { ensureProjectDirs } from '../storage/workspace-paths'
import { probeMediaFile } from './media-probe'
import { buildShots, detectSceneChanges, extractShotFrames } from './shot-detection'

/**
 * Dò cú máy cho một asset rồi lưu kết quả vào cache của project.
 *
 * Lưu lại vì việc này tốn thời gian: ffmpeg phải quét hết video một lượt. Người
 * dùng bấm lại, hoặc agent hỏi lần thứ hai, thì đọc từ cache thay vì quét lại.
 *
 * Cache nằm trong thư mục cache của project — xoá đi vẫn dò lại được, nên nó
 * không thuộc tài liệu project.
 */

export interface ShotDetectionResult {
  shots: DetectedShotDto[]
  /** Nơi lưu, để ghi vào `asset.derived.shotsPath`. */
  shotsPath: string
}

export async function detectShotsForAsset(options: {
  projectId: string
  assetId: string
  sourcePath: string
  /** Bỏ qua cache và quét lại từ đầu. */
  force?: boolean
}): Promise<ShotDetectionResult> {
  const paths = await ensureProjectDirs(options.projectId)
  const shotsPath = join(paths.cacheDir, `shots-${options.assetId}.json`)
  const framesDir = join(paths.cacheDir, `shots-${options.assetId}`)

  if (!options.force) {
    try {
      const cached = JSON.parse(await readFile(shotsPath, 'utf8')) as DetectedShotDto[]
      if (Array.isArray(cached) && cached.length > 0) return { shots: cached, shotsPath }
    } catch {
      // Chưa có cache, hoặc file hỏng — quét lại.
    }
  }

  const { probe } = await probeMediaFile(options.sourcePath)
  const boundaries = await detectSceneChanges(options.sourcePath)
  const shots = buildShots(boundaries, probe.durationUs)
  const withFrames = await extractShotFrames(options.sourcePath, shots, framesDir)

  const dto: DetectedShotDto[] = withFrames.map((shot) => ({
    index: shot.index,
    startUs: shot.startUs,
    endUs: shot.endUs,
    framePath: shot.framePath,
    synthetic: shot.synthetic
  }))

  await writeFile(shotsPath, JSON.stringify(dto), 'utf8')
  return { shots: dto, shotsPath }
}
