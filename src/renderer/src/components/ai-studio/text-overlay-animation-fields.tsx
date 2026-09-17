import type { JSX } from 'react'
import type {
  TextAnimation,
  TextExitAnimation,
  TextOverlay
} from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'

const ANIMATIONS: Array<{
  value: TextAnimation
  labelKey:
    'animationNone' | 'animationFade' | 'animationPop' | 'animationSlideUp' | 'animationTypewriter'
}> = [
  { value: 'none', labelKey: 'animationNone' },
  { value: 'fade', labelKey: 'animationFade' },
  { value: 'pop', labelKey: 'animationPop' },
  { value: 'slide-up', labelKey: 'animationSlideUp' },
  { value: 'typewriter', labelKey: 'animationTypewriter' }
]

const EXITS: Array<{
  value: TextExitAnimation
  labelKey: 'exitNone' | 'exitFade' | 'exitShrink' | 'exitSlideDown'
}> = [
  { value: 'none', labelKey: 'exitNone' },
  { value: 'fade', labelKey: 'exitFade' },
  { value: 'shrink', labelKey: 'exitShrink' },
  { value: 'slide-down', labelKey: 'exitSlideDown' }
]

/** Tab Animation của một chữ: cách chữ vào và cách chữ ra. */
export function TextOverlayAnimationFields({
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
      <div className="field-row">
        <span className="field-row__label">{t.textOverlay.animation}</span>
        <select
          value={overlay.animation}
          aria-label={label(t.textOverlay.animation)}
          onChange={(event) =>
            run(
              [
                {
                  type: 'text/update',
                  overlayId: overlay.id,
                  animation: event.target.value as TextAnimation
                }
              ],
              'Đổi animation vào'
            )
          }
        >
          {ANIMATIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t.textOverlay[option.labelKey]}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.textOverlay.exit}</span>
        <select
          value={overlay.exitAnimation ?? 'none'}
          aria-label={label(t.textOverlay.exit)}
          onChange={(event) =>
            run(
              [
                {
                  type: 'text/update',
                  overlayId: overlay.id,
                  exitAnimation: event.target.value as TextExitAnimation
                }
              ],
              'Đổi animation ra'
            )
          }
        >
          {EXITS.map((option) => (
            <option key={option.value} value={option.value}>
              {t.textOverlay[option.labelKey]}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}
