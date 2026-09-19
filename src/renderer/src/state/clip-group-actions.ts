import {
  expandToLinkGroups,
  isGroupedClip,
  planGroupClips,
  planSplitClip,
  planUngroupClips
} from '../../../shared/domain/clip-link-groups'
import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from './editor-store'

/**
 * Gộp / rã nhóm các clip đang chọn — dùng chung cho nút trên thanh công cụ và
 * phím tắt Cmd+G / Cmd+Shift+G, để hai lối vào không lệch nhau.
 *
 * Đọc store lúc gọi chứ không theo dõi: chỉ cần trạng thái đúng lúc bấm.
 */

export function groupSelectedClips(label: string): boolean {
  const store = useEditorStore.getState()
  const command = planGroupClips(store.selection.clipIds, createId('group'))
  if (!command) return false
  return store.run([command], label)
}

export function ungroupSelectedClips(label: string): boolean {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return false
  const command = planUngroupClips(document, store.selection.clipIds)
  if (!command) return false
  return store.run([command], label)
}

/** Phần state mà hai hàm chọn dưới cần — nhận state để dùng được làm selector. */
interface GroupSelectionState {
  session: { document: ProjectDocument } | null
  selection: { clipIds: string[] }
}

/** Vùng chọn có ít nhất một clip nằm trong nhóm — để bật/tắt nút rã nhóm. */
export function selectionHasGroup({ session, selection }: GroupSelectionState): boolean {
  if (!session) return false
  return selection.clipIds.some((id) => isGroupedClip(session.document, id))
}

/** Vùng chọn gộp được: từ hai clip trở lên và chưa phải đúng một nhóm sẵn có. */
export function selectionCanGroup({ session, selection }: GroupSelectionState): boolean {
  if (!session || selection.clipIds.length < 2) return false
  const first = selection.clipIds[0]
  const sameGroup = expandToLinkGroups(session.document, [first])
  const alreadyOneGroup =
    isGroupedClip(session.document, first) &&
    sameGroup.length === selection.clipIds.length &&
    selection.clipIds.every((id) => sameGroup.includes(id))
  return !alreadyOneGroup
}

/**
 * Cắt clip tại `atUs` — cả nhóm của nó nếu có. Dùng chung cho nút kéo, phím S và
 * công cụ Blade, để ba lối không cắt nhóm theo ba kiểu.
 */
export function splitClipAt(clipId: string, atUs: number, label: string): boolean {
  const store = useEditorStore.getState()
  const document = store.session?.document
  if (!document) return false
  const { commands } = planSplitClip(document, clipId, atUs, (prefix) => createId(prefix))
  return commands.length > 0 && store.run(commands, label)
}
