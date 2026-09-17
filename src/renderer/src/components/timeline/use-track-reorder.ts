import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import {
  insertionSlot,
  reorderChangesOrder,
  reorderToIndex
} from '../../../../shared/domain/track-reorder'
import { useEditorStore } from '../../state/editor-store'

/**
 * Kéo đầu lane để sắp lại thứ tự lane.
 *
 * Theo đúng lối của mọi phép kéo khác trong timeline: trong lúc kéo chỉ giữ một
 * trạng thái xem trước cục bộ, document chỉ đổi MỘT lần lúc thả. Đổi theo từng sự
 * kiện chuột sẽ nhồi hàng trăm bước vào lịch sử hoàn tác, và mỗi bước lại xáo
 * lại thứ tự lớp của cả bản dựng.
 *
 * Đo chỗ thả bằng chính các hàng đang hiện trên màn hình, không bằng phép nhân
 * chiều cao: lane có chiều cao riêng, và lane ảo ở cuối không phải track nào cả.
 */

export interface TrackReorderState {
  /** Lane đang bị kéo. */
  trackId: string
  /** Khe sẽ chèn vào, đếm theo danh sách gốc. */
  slot: number
  /** Toạ độ Y của vạch chỉ chỗ thả, so với cột đầu lane. */
  indicatorY: number
}

export function useTrackReorder(options: {
  document: ProjectDocument | null
  trackRowRefs: React.RefObject<Map<string, HTMLDivElement>>
  headsRef: React.RefObject<HTMLDivElement | null>
}): {
  reorder: TrackReorderState | null
  handleReorderPointerDown(event: ReactPointerEvent<HTMLElement>, trackId: string): void
} {
  const { document, trackRowRefs, headsRef } = options
  const run = useEditorStore((state) => state.run)
  const [reorder, setReorder] = useState<TrackReorderState | null>(null)
  const reorderRef = useRef<TrackReorderState | null>(null)

  const handleReorderPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, trackId: string) => {
      if (!document) return
      const fromIndex = document.tracks.findIndex((track) => track.id === trackId)
      if (fromIndex < 0) return

      event.preventDefault()
      event.stopPropagation()
      const pointerId = event.pointerId

      // Kéo chuột chỉ mới là ý định; chưa di quá một khoảng thì coi như bấm.
      const startY = event.clientY
      let moved = false

      const rowsOf = (): Array<{ top: number; bottom: number }> =>
        document.tracks.map((track) => {
          const element = trackRowRefs.current.get(track.id)
          const rect = element?.getBoundingClientRect()
          return { top: rect?.top ?? 0, bottom: rect?.bottom ?? 0 }
        })

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return
        if (!moved && Math.abs(moveEvent.clientY - startY) < 4) return
        moved = true

        const rows = rowsOf()
        const slot = insertionSlot(moveEvent.clientY, rows)
        const heads = headsRef.current?.getBoundingClientRect()
        const edgeY = slot === 0 ? rows[0]?.top : rows[slot - 1]?.bottom
        const next: TrackReorderState = {
          trackId,
          slot,
          indicatorY: (edgeY ?? 0) - (heads?.top ?? 0)
        }
        reorderRef.current = next
        setReorder(next)
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)

        const final = reorderRef.current
        reorderRef.current = null
        setReorder(null)
        if (!moved || !final) return
        // Thả ngay trên hoặc ngay dưới chính nó là không đổi gì.
        if (!reorderChangesOrder(final.slot, fromIndex)) return

        run(
          [{ type: 'track/reorder', trackId, toIndex: reorderToIndex(final.slot, fromIndex) }],
          'Đổi thứ tự track'
        )
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [document, headsRef, run, trackRowRefs]
  )

  return { reorder, handleReorderPointerDown }
}
