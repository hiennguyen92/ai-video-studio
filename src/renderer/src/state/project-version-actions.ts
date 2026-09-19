import type { MissingMediaReport } from '../../../shared/ipc/ipc-contract'
import { useEditorStore } from './editor-store'

/**
 * Khôi phục một bản chụp phiên bản vào dự án đang mở.
 *
 * Ba chốt, theo thứ tự:
 *
 * 1. Chụp bản HIỆN TẠI trước (`before-restore`), và dừng hẳn nếu chụp hỏng.
 *    Khôi phục thay cả phiên làm việc nên lịch sử hoàn tác không vươn qua nó;
 *    bản chụp này là đường lui duy nhất khi khôi phục nhầm.
 * 2. `revision` của bản khôi phục là revision HIỆN TẠI + 1, không phải số cũ
 *    trong bản chụp. Tác vụ AI chụp revision lúc bắt đầu rồi so lại trước khi
 *    ghi; lùi revision về số cũ thì vài lần sửa sau nó trùng lại đúng số tác vụ
 *    đã chụp, và kết quả cũ ghi đè lên nội dung đã khác hẳn.
 * 3. Kiểm lại media: bản cũ có thể trỏ tới file đã bị dọn (ví dụ audio lồng
 *    tiếng đã xoá bằng "dọn file rác"). Báo ra thay vì để timeline im lặng.
 */
export async function restoreProjectVersion(
  fileName: string
): Promise<{ ok: true; missingMedia: MissingMediaReport[] } | { ok: false; error: string }> {
  const store = useEditorStore.getState()
  const current = store.session?.document
  if (!current) return { ok: false, error: 'Chưa mở dự án nào' }

  const backup = await window.api.project.snapshot(current, 'before-restore')
  if (!backup.ok) return { ok: false, error: backup.error }

  const loaded = await window.api.project.loadVersion(current.id, fileName)
  if (!loaded.ok) return { ok: false, error: loaded.error }

  const restored = {
    ...loaded.data,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString()
  }
  store.openProject(restored)
  // `openProject` coi tài liệu là đã lưu; bản khôi phục thì chưa nằm trong
  // project.json, nên đánh dấu để autosave ghi xuống.
  useEditorStore.getState().setSaveState('dirty')

  const check = await window.api.project.checkMedia(restored)
  return { ok: true, missingMedia: check.ok ? check.data : [] }
}
