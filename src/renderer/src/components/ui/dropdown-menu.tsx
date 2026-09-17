import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

export interface DropdownMenuItem {
  key: string
  label: string
  /** Tên đầy đủ cho trình đọc màn hình khi nhãn hiện ra ngắn hơn. */
  ariaLabel?: string
  icon?: ReactNode
  onSelect(): void
}

/**
 * Menu thả xuống gắn dưới một nút, dùng chung kiểu `.context-menu`.
 *
 * Vẽ bằng portal ra `document.body`: thanh công cụ nằm trong vùng có `overflow`,
 * đặt menu bên trong thì bị cắt mất. Đóng khi bấm ra ngoài, Escape, cuộn, đổi cỡ
 * cửa sổ hoặc cửa sổ mất focus. Mở ra là focus mục đầu, mũi tên lên/xuống đi giữa
 * các mục; Escape trả focus về nút.
 */
export function DropdownMenu({
  anchor,
  label,
  items,
  onClose
}: {
  anchor: HTMLElement
  label: string
  items: DropdownMenuItem[]
  onClose(): void
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState(() => {
    const rect = anchor.getBoundingClientRect()
    return { left: rect.left, top: rect.bottom + 4 }
  })

  // Kẹp vào trong cửa sổ; sát mép dưới thì lật lên trên nút.
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = anchor.getBoundingClientRect()
    const { width, height } = menu.getBoundingClientRect()
    const below = rect.bottom + 4
    setPosition({
      left: Math.max(4, Math.min(rect.left, window.innerWidth - width - 4)),
      top: below + height > window.innerHeight - 4 ? Math.max(4, rect.top - height - 4) : below
    })
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [anchor])

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent): void => {
      const node = event.target as Node
      // Bấm lại vào chính nút: để nút tự đảo trạng thái, không đóng rồi mở lại.
      if (!menuRef.current?.contains(node) && !anchor.contains(node)) onClose()
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
  }, [anchor, onClose])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      anchor.focus()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const entries = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = entries.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    entries[(index + step + entries.length) % entries.length]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          className="context-menu__item"
          aria-label={item.ariaLabel}
          onClick={() => {
            item.onSelect()
            onClose()
          }}
        >
          <span className="context-menu__icon" aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}
