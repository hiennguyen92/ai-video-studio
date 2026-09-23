import { stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import type { BuildPreviewsRequest } from '../../shared/ipc/ipc-contract'
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
  /**
   * Bỏ filmstrip/waveform ra khỏi lần gọi này; nơi gọi tự dựng sau.
   *
   * Chỉ đường nhập của người dùng bật cờ này: ở đó có giao diện để vá kết quả
   * vào sau, và file 4K khiến hai thứ này chiếm gần hết thời gian chờ. Media do
   * AI tạo đi thẳng vào timeline ngay khi hàm trả về nên vẫn dựng tại chỗ.
   */
  deferPreviews?: boolean
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

  if (!request.deferPreviews) {
    Object.assign(
      derived,
      await buildMediaPreviews({
        projectId,
        assetId,
        filePath,
        kind,
        durationUs: probe.durationUs,
        hasAudio: probe.hasAudio
      })
    )
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
/**
 * Dựng filmstrip và waveform — phần NẶNG, chạy sau khi nhập đã xong.
 *
 * Hai thứ này chỉ để hiển thị timeline; không bản xuất nào phụ thuộc chúng, và
 * timeline thiếu chúng thì lùi về khối màu đặc. Nên chúng không có lý do gì nằm
 * trên đường chờ của việc nhập: file 4K 1,4 GB mất 7 giây dựng filmstrip, trong
 * khi băm, probe và thumbnail cộng lại chưa tới một giây.
 *
 * Lỗi ở đây KHÔNG ném ra: người dùng đã nhập xong từ lâu và đang dựng phim, làm
 * hỏng việc của họ vì một cái filmstrip là không đáng.
 */
export async function buildMediaPreviews(
  request: BuildPreviewsRequest
): Promise<MediaAsset['derived']> {
  const { assetId, filePath, projectId, kind, durationUs, hasAudio } = request
  const cacheDir = projectPaths(projectId).cacheDir
  const derived: MediaAsset['derived'] = {}

  if (kind === 'video' && durationUs > 0) {
    const filmstripPath = join(cacheDir, `${assetId}-strip.jpg`)
    try {
      const strip = await generateFilmstrip(filePath, filmstripPath, durationUs)
      derived.filmstripPath = filmstripPath
      derived.filmstripFrameCount = strip.frameCount
    } catch {
      // Timeline lùi về hiển thị khối màu đặc.
    }
  }

  if (hasAudio) {
    const waveformPath = join(cacheDir, `${assetId}-peaks.bin`)
    try {
      await extractWaveformPeaks(filePath, waveformPath)
      derived.waveformPath = waveformPath
    } catch {
      // Timeline lùi về hiển thị khối màu đặc.
    }
  }

  return derived
}

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
