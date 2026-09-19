import { useEffect, useState, type JSX } from 'react'
import type { TimelineTool } from '../../state/editor-store'
import {
  SHORTCUT_GROUPS,
  SHOW_SHORTCUTS_EVENT,
  displayKey
} from '../../state/keyboard-shortcut-catalog'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import '../export/export-dialog.css'

/**
 * Bảng phím tắt. Mở bằng phím `?` hoặc nút "Phím tắt" trên thanh trên cùng.
 *
 * Tự lắng nghe sự kiện mở, nên nơi đặt nó chỉ cần gắn một lần và không phải
 * truyền trạng thái mở/đóng qua mấy tầng component.
 */
export function KeyboardShortcutsDialog(): JSX.Element | null {
  const t = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const show = (): void => setOpen(true)
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show)
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show)
  }, [])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Nuốt phím: Escape toàn cục là bỏ chọn, đóng bảng không được kéo theo việc đó.
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape, true)
    return () => window.removeEventListener('keydown', closeOnEscape, true)
  }, [open])

  if (!open) return null

  const toolLabel: Record<TimelineTool, string> = {
    select: t.timeline.toolSelect,
    trim: t.timeline.toolTrim,
    slip: t.timeline.toolSlip,
    'rate-stretch': t.timeline.toolRateStretch,
    blade: t.timeline.toolBlade
  }
  const describe = (label: string): string =>
    label.startsWith('tool:')
      ? toolLabel[label.slice('tool:'.length) as TimelineTool]
      : t.shortcuts[label as keyof typeof t.shortcuts]

  return (
    <div
      className="export-dialog__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.shortcuts.title}
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div className="export-dialog">
        <header className="export-dialog__header">
          <h2>{t.shortcuts.title}</h2>
          <ToolButton label={t.common.close} onClick={() => setOpen(false)} />
        </header>
        <div className="export-dialog__body keyboard-shortcuts">
          {SHORTCUT_GROUPS.map(({ group, entries }) => (
            <section key={group} className="keyboard-shortcuts__group">
              <p className="field-group__title">{t.shortcuts[`group_${group}`]}</p>
              <dl className="keyboard-shortcuts__list">
                {entries.map((entry) => (
                  <div key={entry.label} className="keyboard-shortcuts__row">
                    <dt>
                      {entry.keys.map((key) => (
                        <kbd key={key}>{displayKey(key, window.api.platform)}</kbd>
                      ))}
                    </dt>
                    <dd>{describe(entry.label)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
