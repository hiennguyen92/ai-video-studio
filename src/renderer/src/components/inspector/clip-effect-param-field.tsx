import type { JSX } from 'react'
import type { EffectParamSpec, EffectParamValue } from '../../../../shared/domain/clip-effect-types'
import { effectParamPath } from '../../../../shared/domain/keyframe-property-catalog'
import { KeyframeDiamondButton } from './keyframe-diamond-button'
import { useKeyframeField } from './use-keyframe-field'

/**
 * Một ô chỉnh thông số effect, dựng theo đặc tả trong danh mục: số → thanh trượt,
 * màu → ô chọn màu, lựa chọn → hộp chọn. Thêm effect mới không phải viết giao diện.
 */
export function ClipEffectParamField({
  spec,
  value,
  locale,
  onChange,
  clipId,
  effectId
}: {
  spec: EffectParamSpec
  value: EffectParamValue | undefined
  locale: string
  onChange(value: EffectParamValue): void
  /** Thiếu một trong hai thì không có nút kim cương — thẻ minh hoạ ngoài timeline. */
  clipId?: string
  effectId?: string
}): JSX.Element {
  const label = locale === 'en' ? spec.labelEn : spec.labelVi
  // Chỉ thông số SỐ mới nội suy được; hai nhánh màu và lựa chọn bên dưới không
  // bao giờ mọc nút, và đó là cố ý — một nút mờ ở đó vẫn là một câu hỏi thừa.
  const animatable = spec.type === 'number' && clipId !== undefined && effectId !== undefined
  const keyframe = useKeyframeField(
    animatable ? { kind: 'clip', clipId } : undefined,
    animatable ? [effectParamPath(effectId, spec.key)] : [],
    label
  )

  if (spec.type === 'number') {
    const current = typeof value === 'number' ? value : spec.default
    const decimals = spec.step < 1 ? (String(spec.step).split('.')[1]?.length ?? 1) : 0
    return (
      <div className={`field-row${animatable ? ' field-row--keyframable' : ''}`}>
        <span className="field-row__label">{label}</span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={current}
          aria-label={label}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (keyframe.animated) keyframe.commit(next)
            else onChange(next)
          }}
        />
        <span className="field-row__value">
          {current.toFixed(decimals)}
          {spec.unit ?? ''}
        </span>
        {animatable && <KeyframeDiamondButton field={keyframe} value={current} label={label} />}
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
