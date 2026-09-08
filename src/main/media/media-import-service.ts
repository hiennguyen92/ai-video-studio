import { stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { createId } from '../../shared/domain/project-document-factory'
import { projectPaths } from '../storage/workspace-paths'
import { computeMediaContentHash } from './media-content-hash'
import { generateFilmstrip, generateThumbnail } from './media-thumbnail-generator'
import { extractWaveformPeaks } from './media-waveform-extractor'
import { probeMediaFile } from './media-probe'

/**
 * Import media vào project.
 *
 * File nguồn KHÔNG bị sao chép và KHÔNG bị sửa: project chỉ giữ tham chiếu tới
 * đường dẫn gốc (DESCRIPTION §7 — chỉnh sửa không phá huỷ file nguồn). Chỉ dữ
 * liệu phái sinh (thumbnail, filmstrip, waveform) mới nằm trong cache của project.
 */

export interface ImportMediaRequest {
  projectId: string
  filePath: string
  /** Media do AI tạo mang thêm thông tin nguồn gốc. */
  generated?: MediaAsset['generated']
}

export interface ImportMediaResult {
  asset: MediaAsset
  /** Bật khi file này đã có trong project (trùng hash) — nơi gọi nên tái dùng asset cũ. */
  duplicateOfAssetId?: string
}

const VIDEO_THUMBNAIL_POSITION_RATIO = 0.1

export async function importMediaFile(
  request: ImportMediaRequest,
  existingAssets: MediaAsset[]
): Promise<ImportMediaResult> {
  const { filePath, projectId } = request
  const stats = await stat(filePath)
  const contentHash = await computeMediaContentHash(filePath)

  const duplicate = existingAssets.find((asset) => asset.source.contentHash === contentHash)
  if (duplicate) {
    return { asset: duplicate, duplicateOfAssetId: duplicate.id }
  }

  const { probe, kind } = await probeMediaFile(filePath)
  const assetId = createId('asset')
  const cacheDir = projectPaths(projectId).cacheDir

  const derived: MediaAsset['derived'] = {}

  if (kind === 'video' || kind === 'image') {
    const thumbnailPath = join(cacheDir, `${assetId}-thumb.jpg`)
    const seekUs = kind === 'video' ? probe.durationUs * VIDEO_THUMBNAIL_POSITION_RATIO : 0
    try {
      await generateThumbnail(filePath, thumbnailPath, seekUs)
      derived.thumbnailPath = thumbnailPath
    } catch {
      // Không có thumbnail thì thư viện hiển thị ô trống — không đáng để chặn import.
    }
  }

  if (kind === 'video' && probe.durationUs > 0) {
    const filmstripPath = join(cacheDir, `${assetId}-strip.jpg`)
    try {
      const strip = await generateFilmstrip(filePath, filmstripPath, probe.durationUs)
      derived.filmstripPath = filmstripPath
      derived.filmstripFrameCount = strip.frameCount
    } catch {
      // Timeline lùi về hiển thị khối màu đặc.
    }
  }

  if (probe.hasAudio) {
    const waveformPath = join(cacheDir, `${assetId}-peaks.bin`)
    try {
      await extractWaveformPeaks(filePath, waveformPath)
      derived.waveformPath = waveformPath
    } catch {
      // Timeline lùi về hiển thị khối màu đặc.
    }
  }

  const asset: MediaAsset = {
    id: assetId,
    kind,
    name: basename(filePath, extname(filePath)) + extname(filePath),
    source: {
      path: filePath,
      contentHash,
      sizeBytes: stats.size,
      mtimeMs: stats.mtimeMs
    },
    probe,
    derived,
    origin: request.generated ? 'generated' : 'import',
    generated: request.generated,
    tags: [],
    createdAt: new Date().toISOString(),
    missing: false
  }

  return { asset }
}

/**
 * Trỏ asset bị thiếu sang file mới (DESCRIPTION §7 "cho phép liên kết lại").
 * Giữ nguyên id nên mọi clip đang dùng asset vẫn hoạt động.
 */
export async function relinkMediaAsset(asset: MediaAsset, newPath: string): Promise<MediaAsset> {
  const stats = await stat(newPath)
  const contentHash = await computeMediaContentHash(newPath)
  const { probe } = await probeMediaFile(newPath)

  return {
    ...asset,
    source: { path: newPath, contentHash, sizeBytes: stats.size, mtimeMs: stats.mtimeMs },
    probe,
    missing: false
  }
}
