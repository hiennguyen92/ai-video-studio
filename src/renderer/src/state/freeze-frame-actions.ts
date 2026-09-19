import { createId } from '../../../shared/domain/project-document-factory'
import {
  DEFAULT_FREEZE_US,
  planFreezeFrame,
  resolveFreezeFrameSource
} from '../../../shared/domain/freeze-frame-planner'
import { useEditorStore } from './editor-store'

/**
 * Đóng băng khung tại đầu phát trên clip đang chọn: dựng đoạn đứng hình ở main
 * rồi chèn lên timeline trong MỘT bước hoàn tác.
 *
 * Lập kế hoạch lại trên tài liệu SAU khi ffmpeg xong — người dùng có thể đã sửa gì
 * đó trong lúc chờ. Mốc đóng băng thì giữ nguyên mốc lúc bấm: đó là khung họ nhìn.
 */
export async function freezeFrameAtPlayhead(
  label: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = useEditorStore.getState()
  const document = store.session?.document
  const clipId = store.selection.clipIds[0]
  if (!document || !clipId) return { ok: false, error: 'Chưa chọn clip nào' }

  let source
  try {
    source = resolveFreezeFrameSource(document, clipId, store.playheadUs)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const created = await window.api.media.freezeFrame({
    projectId: document.id,
    source: source.sourceAsset,
    sourceUs: source.sourceUs,
    frameRate: document.settings.frameRate,
    existing: document.assets
  })
  if (!created.ok) return { ok: false, error: created.error }

  const latest = useEditorStore.getState().session?.document
  if (!latest) return { ok: false, error: 'Dự án đã bị đóng trong lúc dựng khung' }
  try {
    const again = resolveFreezeFrameSource(latest, clipId, source.atUs)
    const commands = planFreezeFrame(latest, again, created.data, DEFAULT_FREEZE_US, (prefix) =>
      createId(prefix)
    )
    return useEditorStore.getState().run(commands, label)
      ? { ok: true }
      : { ok: false, error: 'Không chèn được đoạn đứng hình lên timeline' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
