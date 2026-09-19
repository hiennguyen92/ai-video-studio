import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent
} from 'react'
import { createPortal } from 'react-dom'
import {
  MARKER_COLORS,
  type MarkerColor,
  type TimelineMarker
} from '../../../../shared/domain/timeline-marker-types'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'

/**
 * Menu sửa một marker: tên, màu, xoá.
 *
 * Cùng khuôn với menu chấm keyframe — portal ra `body`, đóng khi bấm ra ngoài /
 * Escape / cuộn / đổi cỡ cửa sổ — vì thước nằm trong vùng cuộn ngang.
 *
 * Tên chỉ ghi lúc Enter hoặc lúc menu đóng, không ghi theo từng phím: mỗi phím
 * một bước hoàn tác thì Cmd+Z xoá tên từng chữ một.
 */
export function TimelineMarkerMenu({
  marker,
  x,
  y,
  onClose
}: {
  marker: TimelineMarker
  x: number
  y: number
  onClose(): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [label, setLabel] = useState(marker.label)
  // Chữ đang gõ, đọc được từ các lối đóng menu (bấm ra ngoài, cuộn…) mà không
  // phải đăng ký lại listener theo từng phím.
  const labelRef = useRef(marker.label)

  // Ghi tên (nếu đổi) rồi đóng. Mọi lối đóng đều đi qua đây để không mất chữ đã gõ.
  const commitAndClose = useCallback(() => {
    if (labelRef.current !== marker.label) {
      run(
        [{ type: 'marker/update', markerId: marker.id, patch: { label: labelRef.current } }],
        t.timeline.markerRename
      )
    }
    onClose()
  }, [marker.id, marker.label, run, onClose, t.timeline.markerRename])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4))
    })
    menu.querySelector<HTMLInputElement>('input')?.select()
  }, [x, y])

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) commitAndClose()
    }
    window.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('resize', commitAndClose)
    window.addEventListener('scroll', commitAndClose, true)
    window.addEventListener('blur', commitAndClose)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('resize', commitAndClose)
      window.removeEventListener('scroll', commitAndClose, true)
      window.removeEventListener('blur', commitAndClose)
    }
  }, [commitAndClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Nuốt phím: Escape toàn cục là bỏ chọn. Và Escape là HUỶ — không ghi tên.
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      commitAndClose()
    }
  }

  const setColor = (color: MarkerColor): void => {
    run([{ type: 'marker/update', markerId: marker.id, patch: { color } }], t.timeline.markerColor)
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu timeline-marker-menu"
      role="dialog"
      aria-label={t.timeline.marker}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu__title">{t.timeline.marker}</div>
      <input
        className="timeline-marker-menu__input"
        value={label}
        maxLength={200}
        placeholder={t.timeline.markerUntitled}
        aria-label={t.timeline.markerName}
        onChange={(event) => {
          labelRef.current = event.target.value
          setLabel(event.target.value)
        }}
      />
      <div className="context-menu__label">{t.timeline.markerColor}</div>
      <div
        className="timeline-marker-menu__colors"
        role="radiogroup"
        aria-label={t.timeline.markerColor}
      >
        {MARKER_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={marker.color === color}
            aria-label={color}
            className={`timeline-marker-menu__swatch timeline-marker--${color}`}
            onClick={() => setColor(color)}
          />
        ))}
      </div>
      <div className="context-menu__separator" role="separator" />
      <button
        type="button"
        className="context-menu__item context-menu__item--danger"
        onClick={() => {
          run([{ type: 'marker/remove', markerId: marker.id }], t.timeline.markerRemove)
          onClose()
        }}
      >
        {t.timeline.markerRemove}
      </button>
    </div>,
    document.body
  )
}
