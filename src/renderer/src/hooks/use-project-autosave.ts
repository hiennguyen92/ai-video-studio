import { useEffect, useRef } from 'react'
import { useEditorStore } from '../state/editor-store'

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
  const inFlight = useRef(false)

  useEffect(() => {
    if (!session || saveState !== 'dirty') return

    const timer = window.setTimeout(async () => {
      if (inFlight.current) return
      inFlight.current = true
      setSaveState('saving')

      // Chụp lại document ngay lúc này. Người dùng có thể sửa tiếp trong khi ghi đĩa;
      // ta lưu đúng bản đã chụp và để lần dirty kế tiếp lo phần thay đổi sau đó.
      const documentToSave = session.document

      try {
        const result = await window.api.project.save(documentToSave)
        if (!result.ok) {
          setSaveState('error')
          setError(result.error)
          return
        }

        // Chỉ chuyển sang "đã lưu" nếu chưa có thay đổi mới xen vào giữa chừng.
        const current = useEditorStore.getState()
        if (current.session?.document.revision === documentToSave.revision) {
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
      } finally {
        inFlight.current = false
      }
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [session, saveState, setSaveState, setError])
}
