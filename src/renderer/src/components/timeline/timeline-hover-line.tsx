import type { JSX } from 'react'
import { useEditorStore } from '../../state/editor-store'
import { usToPx } from './timeline-geometry'

/**
 * Vạch mờ tại vị trí chuột trên timeline — cho biết khung xem trước nhỏ ở góc
 * preview đang hiện thời điểm nào. Component riêng để chỉ nó vẽ lại khi rê chuột.
 */
export function TimelineHoverLine({
  pixelsPerSecond
}: {
  pixelsPerSecond: number
}): JSX.Element | null {
  const hoverUs = useEditorStore((state) => state.hoverUs)
  if (hoverUs === null) return null
  return <div className="timeline__hover-line" style={{ left: usToPx(hoverUs, pixelsPerSecond) }} />
}
