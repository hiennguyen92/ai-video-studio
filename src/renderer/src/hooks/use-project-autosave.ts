import { useEffect, useRef } from 'react'
import { useEditorStore } from '../state/editor-store'
import { saveDocument } from '../state/project-save-queue'

/**
 * Tự động lưu project sau khi người dùng ngừng thao tác.
 *
 * Có hoãn (debounce) vì kéo một clip sinh ra hàng chục lần cập nhật state mỗi giây;
 * ghi đĩa theo từng lần cập nhật sẽ làm giật giao diện.
 *
 * Bản chụp phiên bản được ghi thưa hơn nhiều so với lần lưu thường — nó là lưới an
 * toàn khi file chính hỏng, không phải nhật ký thay đổi.
 */

const AUTOSAVE_DEBOUNCE_MS = 1200
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000

export function useProjectAutosave(): void {
  const session = useEditorStore((state) => state.session)
  const saveState = useEditorStore((state) => state.saveState)
  const setSaveState = useEditorStore((state) => state.setSaveState)
  const setError = useEditorStore((state) => state.setError)

  const lastSnapshotAt = useRef(0)

  useEffect(() => {
    if (!session || saveState !== 'dirty') return

    // Không bỏ lượt khi lần ghi trước còn đang chạy: trước đây bỏ lượt thì sửa đổi
    // xen vào giữa lần ghi không bao giờ được ghi và trạng thái kẹt ở "chưa lưu".
    // Hàng đợi ghi đã xếp các lần ghi nối đuôi nhau, nên cứ gửi thêm là an toàn.
    const timer = window.setTimeout(async () => {
      setSaveState('saving')

      // Chụp lại document ngay lúc này. Người dùng có thể sửa tiếp trong khi ghi đĩa;
      // ta lưu đúng bản đã chụp và để lần dirty kế tiếp lo phần thay đổi sau đó.
      const documentToSave = session.document

      try {
        const result = await saveDocument(documentToSave)
        if (!result.ok) {
          setSaveState('error')
          setError(result.error)
          return
        }

        // Chỉ chuyển sang "đã lưu" nếu chưa có thay đổi mới xen vào giữa chừng.
        // So DANH TÍNH chứ không so revision: hoàn tác trả revision lùi về, nên một
        // lần sửa mới sau undo có thể trùng số với bản đang ghi dở mà nội dung khác.
        const current = useEditorStore.getState()
        if (current.session?.document === documentToSave) {
          setSaveState('saved')
        }

        const now = Date.now()
        if (now - lastSnapshotAt.current > SNAPSHOT_INTERVAL_MS) {
          lastSnapshotAt.current = now
          void window.api.project.snapshot(documentToSave)
        }
      } catch (error) {
        setSaveState('error')
        setError(error instanceof Error ? error.message : String(error))
      }
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [session, saveState, setSaveState, setError])
}
