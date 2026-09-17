import type { JSX } from 'react'
import { useT } from '../../i18n/use-translation'
import { useEditorStore, type TimelineTool } from '../../state/editor-store'
import { IconBlade, IconCursor, IconRateStretch, IconSlip, IconTrim } from '../ui/icons'

/**
 * Nhóm nút chọn chế độ công cụ của timeline (Selection, Trim, Slip, Rate stretch,
 * Blade). Chỉ một chế độ bật một lúc, nên là nhóm radio chứ không phải các nút bật/tắt
 * rời. Tooltip nói luôn chế độ làm gì và phím tắt của nó.
 */
export function TimelineToolButtons(): JSX.Element {
  const t = useT()
  const tool = useEditorStore((state) => state.timelineTool)
  const setTool = useEditorStore((state) => state.setTimelineTool)

  const tools: Array<{ key: TimelineTool; label: string; hint: string; icon: JSX.Element }> = [
    {
      key: 'select',
      label: t.timeline.toolSelect,
      hint: t.timeline.toolSelectHint,
      icon: <IconCursor />
    },
    { key: 'trim', label: t.timeline.toolTrim, hint: t.timeline.toolTrimHint, icon: <IconTrim /> },
    { key: 'slip', label: t.timeline.toolSlip, hint: t.timeline.toolSlipHint, icon: <IconSlip /> },
    {
      key: 'rate-stretch',
      label: t.timeline.toolRateStretch,
      hint: t.timeline.toolRateStretchHint,
      icon: <IconRateStretch />
    },
    {
      key: 'blade',
      label: t.timeline.toolBlade,
      hint: t.timeline.toolBladeHint,
      icon: <IconBlade />
    }
  ]

  return (
    <div className="timeline__tools" role="radiogroup" aria-label={t.timeline.toolsGroup}>
      {tools.map((item) => {
        const active = tool === item.key
        return (
          <button
            key={item.key}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={item.label}
            data-tooltip={item.label}
            data-tooltip-hint={item.hint}
            data-tool={item.key}
            className={`button button--icon${active ? ' button--active' : ''}`}
            onClick={() => setTool(item.key)}
          >
            {item.icon}
          </button>
        )
      })}
    </div>
  )
}
