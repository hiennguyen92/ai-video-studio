import type { JSX } from 'react'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'

const seconds = (us: number): number => Number((us / 1_000_000).toFixed(2))
const micros = (value: string): number => Math.max(0, Math.round(Number(value) * 1_000_000))

/** Tab Basic của một chữ: nội dung và giờ bắt đầu/kết thúc. */
export function TextOverlayBasicFields({
  overlay,
  label
}: {
  overlay: TextOverlay
  label(base: string): string
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)

  return (
    <>
      <div className="field-row field-row--stacked">
        <span className="field-row__label">{t.textOverlay.text}</span>
        <textarea
          className="inspector__textarea"
          value={overlay.text}
          rows={3}
          placeholder={t.textOverlay.textPlaceholder}
          aria-label={label(t.textOverlay.text)}
          onChange={(event) =>
            run(
              [{ type: 'text/update', overlayId: overlay.id, text: event.target.value }],
              'Sửa chữ'
            )
          }
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.textOverlay.start}</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={seconds(overlay.startUs)}
          aria-label={label(t.textOverlay.start)}
          onChange={(event) =>
            run(
              [{ type: 'text/update', overlayId: overlay.id, startUs: micros(event.target.value) }],
              'Đổi giờ chữ'
            )
          }
        />
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.textOverlay.end}</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={seconds(overlay.endUs)}
          aria-label={label(t.textOverlay.end)}
          onChange={(event) =>
            run(
              [{ type: 'text/update', overlayId: overlay.id, endUs: micros(event.target.value) }],
              'Đổi giờ chữ'
            )
          }
        />
      </div>
    </>
  )
}
