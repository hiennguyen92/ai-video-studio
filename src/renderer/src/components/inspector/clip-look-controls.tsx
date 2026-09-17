import type { JSX } from 'react'
import { CLIP_LOOKS } from '../../../../shared/domain/clip-look-catalog'
import type { Clip, ClipLook } from '../../../../shared/domain/timeline-track-types'
import { useLocale } from '../../i18n/use-translation'

/**
 * Look màu (LUT dựng sẵn) của clip đang chọn: chọn look và chỉnh cường độ.
 *
 * Tab LUT trong Library là chỗ duyệt bằng hình; ở đây là chỗ chỉnh tinh cho đúng
 * clip — nhất là cường độ, thứ thẻ trong Library không có.
 */
export function ClipLookControls({
  clip,
  onChange
}: {
  clip: Clip
  onChange(look: ClipLook | undefined): void
}): JSX.Element {
  const { t, locale } = useLocale()
  const current = clip.look
  const percent = Math.round((current?.intensity ?? 1) * 100)

  return (
    <>
      <p className="field-group__title">{t.inspector.look}</p>

      <div className="field-row">
        <span className="field-row__label">{t.inspector.look}</span>
        <select
          value={current?.id ?? ''}
          aria-label={t.inspector.look}
          onChange={(event) =>
            onChange(
              event.target.value
                ? { id: event.target.value, intensity: current?.intensity ?? 1 }
                : undefined
            )
          }
        >
          <option value="">{t.inspector.lookNone}</option>
          {CLIP_LOOKS.map((look) => (
            <option key={look.id} value={look.id}>
              {locale === 'en' ? look.nameEn : look.nameVi}
            </option>
          ))}
        </select>
      </div>

      {current && (
        <div className="field-row">
          <span className="field-row__label">{t.inspector.lookIntensity}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            aria-label={t.inspector.lookIntensity}
            onChange={(event) =>
              onChange({ id: current.id, intensity: Number(event.target.value) / 100 })
            }
          />
          <span className="field-row__value">{percent}%</span>
        </div>
      )}
    </>
  )
}
