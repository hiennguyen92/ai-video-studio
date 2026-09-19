import type { ProjectDocument } from '../../../shared/domain/project-document-types'
import type { IpcResult } from '../../../shared/ipc/ipc-contract'
import { useEditorStore } from './editor-store'

/**
 * Mọi lần ghi project.json đi qua MỘT hàng đợi.
 *
 * Hai lần ghi chạy song song là hai lỗi cùng lúc: bên main ghi ra CÙNG một file tạm
 * rồi đổi tên, nên hai lần ghi đè nhau giữa chừng; và lần ghi bản CŨ có thể xong
 * SAU lần ghi bản mới, để lại bản cũ trên đĩa. Xếp hàng thì bản ghi sau cùng luôn
 * là bản được yêu cầu sau cùng.
 */

let chain: Promise<unknown> = Promise.resolve()

export function saveDocument(document: ProjectDocument): Promise<IpcResult<void>> {
  const next = chain.then(() => window.api.project.save(document))
  // Một lần ghi hỏng không được chặn các lần sau trong hàng.
  chain = next.catch(() => undefined)
  return next
}

/**
 * Ghi NGAY sửa đổi đang chờ autosave — gọi trước khi rời dự án hay đóng cửa sổ.
 *
 * Autosave chờ 1,2 s sau lần sửa cuối; rời đi trong khoảng đó thì bộ hẹn giờ bị
 * huỷ cùng giao diện và sửa đổi cuối biến mất không một lời báo.
 */
export async function flushPendingSave(): Promise<IpcResult<void>> {
  const { session, saveState } = useEditorStore.getState()
  if (!session || saveState === 'saved' || saveState === 'idle') {
    // Có thể còn một lần ghi đang chạy: chờ nó xong rồi mới coi là đã lưu.
    await chain
    return { ok: true, data: undefined }
  }

  const document = session.document
  const result = await saveDocument(document)
  if (result.ok && useEditorStore.getState().session?.document === document) {
    useEditorStore.getState().setSaveState('saved')
  }
  return result
}
