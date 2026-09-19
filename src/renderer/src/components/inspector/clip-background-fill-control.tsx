import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { SliderRow } from './inspector-slider-row'

/**
 * Nền mờ phía sau clip — cách đưa cảnh ngang vào khung dọc mà không để hai dải đen.
 *
 * Có nút "áp cho mọi clip hình" vì đây là thao tác cả video chứ ít khi riêng một
 * clip: chuyển một video ngang 20 cảnh sang 9:16 mà phải bấm 20 lần là vô lý.
 * Vẫn là MỘT bước hoàn tác.
 */

const DEFAULT_AMOUNT = 0.5

export function ClipBackgroundFillControl({
  clip,
  run
}: {
  clip: Clip
  run(commands: EditorCommand[], label: string): void
}): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const fill = clip.backgroundFill

  const setFill = (backgroundFill: Clip['backgroundFill'] | null, label: string): void =>
    run([{ type: 'clip/update', clipId: clip.id, patch: { backgroundFill } }], label)

  const applyToAll = (): void => {
    if (!document) return
    const amount = fill?.amount ?? DEFAULT_AMOUNT
    const commands: EditorCommand[] = document.tracks
      .filter((track) => (track.kind === 'video' || track.kind === 'image') && !track.locked)
      .flatMap((track) =>
        track.clips.map((item) => ({
          type: 'clip/update' as const,
          clipId: item.id,
          patch: { backgroundFill: { kind: 'blur' as const, amount } }
        }))
      )
    if (commands.length > 0) run(commands, t.inspector.backgroundFillAll)
  }

  return (
    <>
      <p className="field-group__title">{t.inspector.backgroundFill}</p>
      <label className="field-row">
        <span className="field-row__label">{t.inspector.backgroundFillBlur}</span>
        <input
          type="checkbox"
          checked={fill !== undefined}
          aria-label={t.inspector.backgroundFillBlur}
          onChange={(event) =>
            setFill(
              event.target.checked ? { kind: 'blur', amount: DEFAULT_AMOUNT } : null,
              t.inspector.backgroundFill
            )
          }
        />
      </label>
      {fill && (
        <SliderRow
          label={t.inspector.backgroundFillAmount}
          value={fill.amount}
          min={0}
          max={1}
          step={0.05}
          format={(value) => `${Math.round(value * 100)}%`}
          onCommit={(amount) => setFill({ kind: 'blur', amount }, t.inspector.backgroundFillAmount)}
        />
      )}
      <p className="inspector__hint">{t.inspector.backgroundFillHint}</p>
      <ToolButton label={t.inspector.backgroundFillAll} variant="outline" onClick={applyToAll} />
    </>
  )
}
