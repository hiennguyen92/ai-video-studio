import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { CUT_TRANSITION_DURATIONS_US } from '../../../../shared/domain/timeline-cut-transitions'
import { interpolate, useLocale } from '../../i18n/use-translation'

/**
 * Menu chuột phải của chuyển cảnh ở chỗ nối: chọn thời lượng, hoặc xoá.
 *
 * Vẽ bằng portal ra `document.body` với toạ độ cố định: timeline cuộn ngang và
 * có lớp chồng lớp, đặt menu bên trong thì nó bị cắt ở mép vùng cuộn.
 *
 * Đóng khi bấm ra ngoài, nhấn Escape, cuộn hay đổi cỡ cửa sổ — menu đứng yên
 * trong khi chỗ nối đã trôi đi chỗ khác thì chỉ gây nhầm.
 */
export function TimelineCutContextMenu({
  x,
  y,
  title,
  currentDurationUs,
  onPickDuration,
  onRemove,
  onClose
}: {
  /** Toạ độ màn hình nơi mở menu. */
  x: number
  y: number
  /** Tên kiểu chuyển cảnh, làm tiêu đề menu. */
  title: string
  currentDurationUs: number | undefined
  onPickDuration(durationUs: number): void
  onRemove(): void
  onClose(): void
}): JSX.Element {
  const { t, locale } = useLocale()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // Kẹp vào trong cửa sổ: mở sát mép dưới/phải thì menu không được tràn ra ngoài.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4))
    })
    // Focus mục đầu tiên để dùng được bằng bàn phím ngay.
    menu.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
  }, [x, y])

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', closeOnOutside, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', closeOnOutside, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(index + step + items.length) % items.length]?.focus()
  }

  const formatSeconds = (durationUs: number): string =>
    interpolate(t.timeline.cutTransitionSeconds, {
      seconds: (durationUs / 1_000_000).toLocaleString(locale === 'en' ? 'en' : 'vi')
    })

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={title}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu__title">{title}</div>
      <div className="context-menu__label">{t.timeline.cutTransitionDuration}</div>
      {CUT_TRANSITION_DURATIONS_US.map((durationUs) => {
        const checked = currentDurationUs === durationUs
        return (
          <button
            key={durationUs}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            className={`context-menu__item ${checked ? 'context-menu__item--checked' : ''}`}
            onClick={() => {
              onPickDuration(durationUs)
              onClose()
            }}
          >
            <span className="context-menu__check" aria-hidden>
              {checked ? '✓' : ''}
            </span>
            {formatSeconds(durationUs)}
          </button>
        )
      })}
      <div className="context-menu__separator" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="context-menu__item context-menu__item--danger"
        onClick={() => {
          onRemove()
          onClose()
        }}
      >
        <span className="context-menu__check" aria-hidden />
        {t.timeline.removeCutTransitionShort}
      </button>
    </div>,
    document.body
  )
}
