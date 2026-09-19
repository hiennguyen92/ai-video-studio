import {
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { sortedMarkers, type TimelineMarker } from '../../../../shared/domain/timeline-marker-types'
import { formatClockTime, snapMicrosToFrame } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { pxToUs, usToPx } from './timeline-geometry'
import { TimelineMarkerMenu } from './timeline-marker-menu'

/**
 * Lá cờ marker trên thước thời gian.
 *
 * Bấm là tua tới đúng marker, kéo là dời nó, nháy đúp hoặc chuột phải là mở menu
 * đổi tên / đổi màu / xoá. Mọi sự kiện chuột dừng ở đây: để lọt xuống thước thì
 * bấm vào cờ cũng thành tua theo chỗ chuột, lệch khỏi marker vài khung.
 *
 * Kéo chỉ cập nhật vị trí xem trước cục bộ, ghi vào tài liệu MỘT lần lúc thả —
 * cùng lý do với kéo clip: mỗi sự kiện chuột một bước hoàn tác là nhồi lịch sử.
 */

const CLICK_SLOP_PX = 3

export function TimelineMarkerLayer({
  markers,
  pixelsPerSecond
}: {
  markers: TimelineMarker[]
  pixelsPerSecond: number
}): JSX.Element {
  const t = useT()
  const [dragging, setDragging] = useState<{ id: string; atUs: number } | null>(null)
  const [menu, setMenu] = useState<{ markerId: string; x: number; y: number } | null>(null)
  const draggingRef = useRef(dragging)

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    marker: TimelineMarker
  ): void => {
    event.stopPropagation()
    if (event.button !== 0) return
    event.preventDefault()
    const startX = event.clientX
    const pointerId = event.pointerId
    const store = useEditorStore.getState()
    const frameRate = store.session?.document.settings.frameRate
    if (!frameRate) return

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      if (Math.abs(moveEvent.clientX - startX) < CLICK_SLOP_PX && !draggingRef.current) return
      const atUs = snapMicrosToFrame(
        Math.max(0, marker.atUs + pxToUs(moveEvent.clientX - startX, pixelsPerSecond)),
        frameRate
      )
      draggingRef.current = { id: marker.id, atUs }
      setDragging(draggingRef.current)
    }

    const onUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const final = draggingRef.current
      draggingRef.current = null
      setDragging(null)

      const current = useEditorStore.getState()
      if (final && final.atUs !== marker.atUs) {
        current.run(
          [{ type: 'marker/update', markerId: marker.id, patch: { atUs: final.atUs } }],
          t.timeline.markerMove
        )
      } else if (!final) {
        current.setPlaying(false)
        current.setPlayhead(marker.atUs)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const openMenu = (event: ReactMouseEvent, marker: TimelineMarker): void => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({ markerId: marker.id, x: event.clientX, y: event.clientY })
  }

  const menuMarker = menu ? markers.find((marker) => marker.id === menu.markerId) : undefined

  return (
    <div className="timeline-markers">
      {sortedMarkers(markers).map((marker) => {
        const atUs = dragging?.id === marker.id ? dragging.atUs : marker.atUs
        const name = marker.label.trim() || t.timeline.markerUntitled
        return (
          <button
            key={marker.id}
            type="button"
            className={`timeline-marker timeline-marker--${marker.color}`}
            style={{ left: usToPx(atUs, pixelsPerSecond) }}
            aria-label={`${t.timeline.marker}: ${name} · ${formatClockTime(atUs, false)}`}
            title={`${name}\n${formatClockTime(atUs)}`}
            onPointerDown={(event) => handlePointerDown(event, marker)}
            onDoubleClick={(event) => openMenu(event, marker)}
            onContextMenu={(event) => openMenu(event, marker)}
          >
            <span className="timeline-marker__flag" aria-hidden />
            {marker.label.trim() && <span className="timeline-marker__label">{marker.label}</span>}
          </button>
        )
      })}

      {menu && menuMarker && (
        <TimelineMarkerMenu
          marker={menuMarker}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
