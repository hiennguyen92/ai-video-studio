import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject
} from 'react'
import { expandToLinkGroups } from '../../../../shared/domain/clip-link-groups'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { useEditorStore } from '../../state/editor-store'
import { clipsInMarquee, marqueeFromPoints, type MarqueeRect } from './timeline-marquee-hits'

/** Di ít hơn chừng này thì coi là bấm, không phải kéo khung. */
const DRAG_SLOP_PX = 4

/**
 * Kéo khung trên vùng trống của timeline để chọn nhiều clip một lúc.
 *
 * Trước đây chọn mười clip nghĩa là Shift+bấm mười lần. Bấm vào vùng trống (không
 * kéo) thì bỏ chọn — trước đây nó không làm gì, và cách duy nhất để bỏ chọn là
 * phím Escape mà không ai đoán ra.
 *
 * Giữ Shift / Cmd thì khung CỘNG thêm vào vùng chọn đang có.
 */
export function useTimelineMarqueeSelection(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
  lanesRef: RefObject<HTMLDivElement | null>
  trackRowRefs: RefObject<Map<string, HTMLDivElement>>
}): {
  marquee: MarqueeRect | null
  handleLanesPointerDown(event: ReactPointerEvent<HTMLDivElement>): void
} {
  const { document, pixelsPerSecond, lanesRef, trackRowRefs } = options
  const [marquee, setMarquee] = useState<MarqueeRect | null>(null)
  // Gỡ listener của cú kéo đang dở khi timeline bị gỡ giữa chừng.
  const detachRef = useRef<(() => void) | null>(null)
  useEffect(() => () => detachRef.current?.(), [])

  const handleLanesPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const lanes = lanesRef.current
      const target = event.target as HTMLElement
      // Chỉ vùng TRỐNG: bấm trúng clip, khối chữ, chấm keyframe… đã có xử lý riêng.
      const onEmpty = target === lanes || target.classList.contains('timeline-lane')
      if (!document || !lanes || event.button !== 0 || !onEmpty) return
      event.preventDefault()

      const additive = event.shiftKey || event.metaKey || event.ctrlKey
      const before = useEditorStore.getState().selection.clipIds
      const origin = lanes.getBoundingClientRect()
      const from = { x: event.clientX - origin.left, y: event.clientY - origin.top }
      const pointerId = event.pointerId
      let dragging = false

      const rows = document.tracks.flatMap((track) => {
        const row = trackRowRefs.current?.get(track.id)
        if (!row) return []
        const box = row.getBoundingClientRect()
        return [{ track, top: box.top - origin.top, bottom: box.bottom - origin.top }]
      })

      const select = (rect: MarqueeRect): void => {
        const hits = expandToLinkGroups(document, clipsInMarquee(rows, rect, pixelsPerSecond))
        const clipIds = additive ? [...new Set([...before, ...hits])] : hits
        useEditorStore.getState().setSelection({ clipIds })
      }

      const onMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId) return
        // Cột lane có thể đã cuộn: đọc lại gốc toạ độ mỗi lần.
        const now = lanes.getBoundingClientRect()
        const to = { x: moveEvent.clientX - now.left, y: moveEvent.clientY - now.top }
        if (!dragging && Math.hypot(to.x - from.x, to.y - from.y) < DRAG_SLOP_PX) return
        dragging = true
        const rect = marqueeFromPoints(from, to)
        setMarquee(rect)
        select(rect)
      }
      const detach = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        detachRef.current = null
      }
      const onUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        detach()
        setMarquee(null)
        if (!dragging && !additive) useEditorStore.getState().clearSelection()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      detachRef.current = detach
    },
    [document, pixelsPerSecond, lanesRef, trackRowRefs]
  )

  return { marquee, handleLanesPointerDown }
}
