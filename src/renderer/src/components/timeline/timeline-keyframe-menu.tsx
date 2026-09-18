import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { KeyframeEasing } from '../../../../shared/domain/keyframe-types'
import { useT } from '../../i18n/use-translation'

/**
 * Menu chuột phải trên một chấm keyframe: đổi kiểu nội suy, hoặc xoá.
 *
 * Dựng theo đúng khuôn của menu chuột phải ở chỗ nối chuyển cảnh — portal ra
 * `body`, đóng khi bấm ra ngoài / Escape / cuộn / đổi cỡ cửa sổ — vì timeline
 * cuộn ngang và có lớp chồng lớp: menu vẽ bên trong sẽ bị cắt ở mép vùng cuộn,
 * và menu đứng yên khi nội dung đã trôi đi chỗ khác thì chỉ gây nhầm.
 */

const EASINGS: KeyframeEasing[] = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out']

export function TimelineKeyframeMenu({
  x,
  y,
  easing,
  onPickEasing,
  onRemove,
  onClose
}: {
  x: number
  y: number
  /** `mixed` khi các thuộc tính tại mốc đang dùng nhiều kiểu khác nhau. */
  easing: KeyframeEasing | 'mixed'
  onPickEasing(easing: KeyframeEasing): void
  onRemove(): void
  onClose(): void
}): JSX.Element {
  const t = useT()
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition({
      left: Math.max(4, Math.min(x, window.innerWidth - width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - height - 4))
    })
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
      // NUỐT phím luôn: Escape ở tầng toàn cục là "bỏ chọn", nên để nó đi tiếp
      // thì đóng menu cũng kéo theo bỏ chọn clip — và dải chấm biến mất ngay
      // dưới tay người dùng, đúng lúc họ vừa định bấm tiếp.
      event.stopPropagation()
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

  const easingLabel: Record<KeyframeEasing, string> = {
    linear: t.timeline.easingLinear,
    hold: t.timeline.easingHold,
    'ease-in': t.timeline.easingIn,
    'ease-out': t.timeline.easingOut,
    'ease-in-out': t.timeline.easingInOut
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={t.timeline.keyframeDot}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="context-menu__title">{t.timeline.keyframeDot}</div>
      <div className="context-menu__label">{t.timeline.keyframeEasing}</div>
      {EASINGS.map((item) => {
        const checked = easing === item
        return (
          <button
            key={item}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            className={`context-menu__item ${checked ? 'context-menu__item--checked' : ''}`}
            onClick={() => {
              onPickEasing(item)
              onClose()
            }}
          >
            <span className="context-menu__check" aria-hidden>
              {checked ? '✓' : ''}
            </span>
            {easingLabel[item]}
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
        {t.timeline.keyframeRemove}
      </button>
    </div>,
    document.body
  )
}
