import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import { useEditorStore } from './editor-store'

/**
 * Dựng filmstrip/waveform SAU khi nhập, rồi vá vào asset đã nằm trong document.
 *
 * Vì sao tách khỏi lúc nhập: hai thứ này chỉ để vẽ timeline cho đẹp, không bản
 * xuất nào đụng tới. Với file 4K 1,4 GB chúng chiếm gần hết thời gian chờ, trong
 * khi asset đã đủ dùng ngay khi probe xong.
 *
 * Vá bằng `applySilently`: người dùng đã làm việc khác từ lâu khi ffmpeg xong,
 * nên cái vá KHÔNG được thành một bước hoàn tác (Ctrl+Z sau đó phải gỡ thao tác
 * của họ, không phải gỡ một đường dẫn ảnh), và cũng không được xoá nhánh redo
 * đang có.
 */

/** Chạy lần lượt, không song song: mỗi file là một tiến trình ffmpeg nuốt hết CPU. */
let queue: Promise<void> = Promise.resolve()

function needsPreviews(asset: MediaAsset): boolean {
  const wantsFilmstrip = asset.kind === 'video' && asset.probe.durationUs > 0
  return wantsFilmstrip || asset.probe.hasAudio
}

async function backfillOne(projectId: string, asset: MediaAsset): Promise<void> {
  const result = await window.api.media.buildPreviews({
    projectId,
    assetId: asset.id,
    filePath: asset.source.path,
    kind: asset.kind,
    durationUs: asset.probe.durationUs,
    hasAudio: asset.probe.hasAudio
  })
  if (!result.ok) return
  const derived = result.data
  if (Object.keys(derived).length === 0) return

  // Dự án có thể đã bị đóng hoặc đổi trong lúc ffmpeg chạy: vá nhầm tài liệu
  // khác là thêm đường dẫn cache của dự án cũ vào dự án mới.
  const current = useEditorStore.getState().session?.document
  if (!current || current.id !== projectId) return

  useEditorStore
    .getState()
    .applySilently([{ type: 'asset/set-derived', assetId: asset.id, derived }])
}

export function backfillMediaPreviews(projectId: string, assets: MediaAsset[]): Promise<void> {
  const pending = assets.filter(needsPreviews)
  if (pending.length === 0) return queue

  queue = queue.then(async () => {
    for (const asset of pending) {
      try {
        await backfillOne(projectId, asset)
      } catch {
        // Timeline lùi về khối màu đặc; không có gì để người dùng phải sửa.
      }
    }
  })
  return queue
}
