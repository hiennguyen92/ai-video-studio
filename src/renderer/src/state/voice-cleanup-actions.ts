import { createId } from '../../../shared/domain/project-document-factory'
import {
  planVoiceCleanup,
  resolveVoiceCleanupTarget,
  type VoiceCleanupMode
} from '../../../shared/domain/voice-cleanup-planner'
import type { VoiceCleanupStrength } from '../../../shared/ipc/voice-cleanup-types'
import { useEditorStore } from './editor-store'

/**
 * Làm sạch giọng cho một clip từ giao diện: chạy ffmpeg ở main, rồi đưa kết quả
 * lên timeline trong MỘT bước hoàn tác.
 *
 * Lập kế hoạch lại trên tài liệu SAU khi ffmpeg xong: lọc mất vài giây, và người
 * dùng có thể đã dời clip trong lúc chờ — dùng bản chụp cũ là ghi đè thay đổi đó.
 */
/**
 * Clip đang được làm sạch. Sống ngoài component: rời clip rồi quay lại thì nút là
 * một instance mới, không biết lần chạy trước còn dở — bấm lần nữa là hai lần lọc
 * cùng clip, lần xong sau thay tiếng sạch của lần trước thêm một bước hoàn tác.
 */
const inProgress = new Set<string>()

export function isCleaningVoice(clipId: string): boolean {
  return inProgress.has(clipId)
}

export async function cleanVoiceForClip(
  clipId: string,
  strength: VoiceCleanupStrength,
  label: string
): Promise<{ ok: true; mode: VoiceCleanupMode } | { ok: false; error: string }> {
  if (inProgress.has(clipId)) return { ok: false, error: 'Clip này đang được làm sạch' }
  inProgress.add(clipId)
  try {
    return await cleanVoice(clipId, strength, label)
  } finally {
    inProgress.delete(clipId)
  }
}

async function cleanVoice(
  clipId: string,
  strength: VoiceCleanupStrength,
  label: string
): Promise<{ ok: true; mode: VoiceCleanupMode } | { ok: false; error: string }> {
  const document = useEditorStore.getState().session?.document
  if (!document) return { ok: false, error: 'Chưa mở dự án nào' }

  let source
  try {
    source = resolveVoiceCleanupTarget(document, clipId).sourceAsset
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  const cleaned = await window.api.media.cleanVoice({
    projectId: document.id,
    source,
    strength,
    existing: document.assets
  })
  if (!cleaned.ok) return { ok: false, error: cleaned.error }

  const store = useEditorStore.getState()
  const latest = store.session?.document
  if (!latest || latest.id !== document.id) {
    return { ok: false, error: 'Dự án đã đổi trong lúc làm sạch — chưa áp dụng gì' }
  }
  try {
    const target = resolveVoiceCleanupTarget(latest, clipId)
    const commands = planVoiceCleanup(latest, target, cleaned.data, (prefix) => createId(prefix))
    return store.run(commands, label)
      ? { ok: true, mode: target.mode }
      : { ok: false, error: 'Không áp dụng được lên timeline' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
