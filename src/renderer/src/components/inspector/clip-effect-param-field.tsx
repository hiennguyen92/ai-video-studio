import type { JSX } from 'react'
import type { EffectParamSpec, EffectParamValue } from '../../../../shared/domain/clip-effect-types'

/**
 * Một ô chỉnh thông số effect, dựng theo đặc tả trong danh mục: số → thanh trượt,
 * màu → ô chọn màu, lựa chọn → hộp chọn. Thêm effect mới không phải viết giao diện.
 */
export function ClipEffectParamField({
  spec,
  value,
  locale,
  onChange
}: {
  spec: EffectParamSpec
  value: EffectParamValue | undefined
  locale: string
  onChange(value: EffectParamValue): void
}): JSX.Element {
  const label = locale === 'en' ? spec.labelEn : spec.labelVi

  if (spec.type === 'number') {
    const current = typeof value === 'number' ? value : spec.default
    const decimals = spec.step < 1 ? (String(spec.step).split('.')[1]?.length ?? 1) : 0
    return (
      <div className="field-row">
        <span className="field-row__label">{label}</span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={current}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="field-row__value">
          {current.toFixed(decimals)}
          {spec.unit ?? ''}
        </span>
      </div>
    )
  }

  if (spec.type === 'color') {
    return (
      <div className="field-row">
        <span className="field-row__label">{label}</span>
        <input
          type="color"
          value={(typeof value === 'string' ? value : spec.default).toLowerCase()}
          aria-label={label}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
      </div>
    )
  }

  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <select
        value={typeof value === 'string' ? value : spec.default}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        {spec.options.map((option) => (
          <option key={option.value} value={option.value}>
            {locale === 'en' ? option.labelEn : option.labelVi}
          </option>
        ))}
      </select>
    </div>
  )
}
