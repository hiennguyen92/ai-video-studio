import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

/**
 * Lớp tooltip dùng chung cho cả ứng dụng.
 *
 * Phần tử nào có `data-tooltip` (và tuỳ chọn `data-tooltip-hint` cho dòng mô tả) thì
 * rê chuột hoặc focus bằng bàn phím vào là hiện tooltip. Không dùng `title` của hệ
 * thống: nó hiện chậm cả giây, không có kiểu dáng, và trong Electron thường không
 * hiện khi cửa sổ chưa được focus — người dùng gần như không bao giờ thấy.
 *
 * Nhãn kết thúc bằng "(X)" thì phần trong ngoặc được tách ra thành chip phím tắt.
 *
 * Chỉ MỘT lớp lắng nghe sự kiện ở cấp tài liệu, không bọc từng nút: thêm tooltip cho
 * một nút chỉ là thêm một thuộc tính.
 */

const SHOW_DELAY_MS = 350
/** Vừa có tooltip hiện thì rê sang nút bên cạnh hiện ngay, không bắt chờ lại. */
const WARM_WINDOW_MS = 600

interface TooltipState {
  anchor: HTMLElement
  label: string
  shortcut?: string
  hint?: string
}

function readTooltip(anchor: HTMLElement): TooltipState | null {
  const raw = anchor.dataset.tooltip
  if (!raw) return null
  const match = /^(.*\S)\s+\(([^()]{1,12})\)$/.exec(raw)
  return {
    anchor,
    label: match ? match[1] : raw,
    shortcut: match ? match[2] : undefined,
    hint: anchor.dataset.tooltipHint
  }
}

export function TooltipLayer(): JSX.Element | null {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const lastHiddenAtRef = useRef(0)
  /** Phần tử đang (hoặc sắp) có tooltip — rê qua các phần tử con của nó thì bỏ qua. */
  const anchorRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const hide = (): void => {
      anchorRef.current = null
      window.clearTimeout(timerRef.current)
      setTooltip((current) => {
        if (current) lastHiddenAtRef.current = Date.now()
        return null
      })
    }

    const showFor = (node: EventTarget | null): void => {
      const anchor = node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null
      if (anchor && anchor === anchorRef.current) return
      window.clearTimeout(timerRef.current)
      if (!anchor) {
        hide()
        return
      }
      anchorRef.current = anchor
      const warm = Date.now() - lastHiddenAtRef.current < WARM_WINDOW_MS
      timerRef.current = window.setTimeout(
        () => {
          // Đọc lúc hiện, không lúc rê vào: nhãn có thể đã đổi (bật/tắt bắt dính…).
          if (anchor.isConnected) setTooltip(readTooltip(anchor))
        },
        warm ? 0 : SHOW_DELAY_MS
      )
    }

    const handleOver = (event: PointerEvent): void => showFor(event.target)
    const handleOut = (event: PointerEvent): void => {
      const next = event.relatedTarget instanceof Element ? event.relatedTarget : null
      const leaving = (event.target as Element | null)?.closest?.('[data-tooltip]')
      if (leaving && next && leaving.contains(next)) return
      hide()
    }
    const handleFocus = (event: FocusEvent): void => {
      // Chỉ focus bằng bàn phím: bấm chuột cũng focus nút, và tooltip bật lên ngay
      // lúc vừa bấm thì chỉ làm vướng.
      if (event.target instanceof HTMLElement && event.target.matches(':focus-visible')) {
        showFor(event.target)
      }
    }

    document.addEventListener('pointerover', handleOver)
    document.addEventListener('pointerout', handleOut)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timerRef.current)
      document.removeEventListener('pointerover', handleOver)
      document.removeEventListener('pointerout', handleOut)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('focusin', handleFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  if (!tooltip) return null
  return createPortal(<TooltipBubble tooltip={tooltip} />, document.body)
}

function TooltipBubble({ tooltip }: { tooltip: TooltipState }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  // Dưới nút, canh giữa; sát mép dưới thì lật lên trên; kẹp trong cửa sổ.
  useLayoutEffect(() => {
    const bubble = ref.current
    if (!bubble) return
    const rect = tooltip.anchor.getBoundingClientRect()
    const { width, height } = bubble.getBoundingClientRect()
    const gap = 6
    const below = rect.bottom + gap
    const top = below + height > window.innerHeight - 4 ? rect.top - height - gap : below
    const left = Math.min(
      Math.max(4, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 4
    )
    setPosition({ left, top: Math.max(4, top) })
  }, [tooltip])

  return (
    <div
      ref={ref}
      role="tooltip"
      className="tooltip"
      style={{
        left: position?.left ?? -9999,
        top: position?.top ?? -9999,
        visibility: position ? 'visible' : 'hidden'
      }}
    >
      <div className="tooltip__title">
        <span>{tooltip.label}</span>
        {tooltip.shortcut && <kbd className="tooltip__kbd">{tooltip.shortcut}</kbd>}
      </div>
      {tooltip.hint && <div className="tooltip__hint">{tooltip.hint}</div>}
    </div>
  )
}
