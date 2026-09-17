import { useLayoutEffect, type JSX, type RefObject } from 'react'
import { useEditorStore } from '../../state/editor-store'
import { usToPx } from './timeline-geometry'

/**
 * Vạch đầu phát trên timeline, kèm việc cuộn theo nó.
 *
 * Tách thành component riêng để CHỈ nó theo dõi `playheadUs`. Trước đây cả
 * `TimelinePanel` theo dõi, nên khi đang phát cả timeline — mọi lane, mọi clip —
 * vẽ lại mỗi khung. Luồng chính bận tới mức Player của Remotion tụt khung, hình
 * chạy chậm hơn tiếng, và Remotion kéo tiếng lùi lại cho khớp: nghe như lặp.
 */
export function TimelinePlayhead({
  bodyRef,
  pixelsPerSecond,
  laneViewportWidth
}: {
  bodyRef: RefObject<HTMLDivElement | null>
  pixelsPerSecond: number
  laneViewportWidth(): number
}): JSX.Element {
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const playheadX = usToPx(playheadUs, pixelsPerSecond)

  // Giữ playhead luôn trong tầm nhìn khi nó chạy ra ngoài vùng cuộn.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const width = laneViewportWidth()
    if (width <= 0) return

    const left = body.scrollLeft
    const right = left + width
    if (playheadX < left + 40) body.scrollLeft = Math.max(0, playheadX - 80)
    else if (playheadX > right - 60) body.scrollLeft = playheadX - width + 120
  }, [playheadX, bodyRef, laneViewportWidth])

  return (
    <div className="timeline__playhead" style={{ left: playheadX }}>
      <div className="timeline__playhead-handle" />
    </div>
  )
}
