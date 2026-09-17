import { useState, type JSX, type ReactNode } from 'react'

/**
 * Nhóm ô gập/mở được trong panel. Gập thì nội dung KHÔNG nằm trong cây DOM — panel
 * dài chỉ còn các tiêu đề, người dùng mở đúng nhóm mình cần.
 */
export function CollapsibleSection({
  title,
  meta,
  defaultOpen = false,
  children
}: {
  title: string
  /** Chữ phụ bên phải tiêu đề, ví dụ số câu. */
  meta?: string
  defaultOpen?: boolean
  children: ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className={`collapsible${open ? ' collapsible--open' : ''}`}>
      <button
        type="button"
        className="collapsible__header"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="collapsible__chevron" aria-hidden>
          ▸
        </span>
        <span className="collapsible__title">{title}</span>
        {meta && <span className="collapsible__meta">{meta}</span>}
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </section>
  )
}
