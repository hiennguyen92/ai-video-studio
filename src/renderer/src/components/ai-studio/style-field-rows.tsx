import type { JSX } from 'react'
import { KeyframeDiamondButton } from '../inspector/keyframe-diamond-button'
import type { KeyframeField } from '../inspector/use-keyframe-field'

/**
 * Hàng ô chỉnh kiểu chữ dùng chung: thanh trượt có số NGAY CÙNG HÀNG (không rơi
 * xuống dòng dưới), và nhóm nút chọn một trong vài giá trị.
 *
 * Khác `SliderRow` của Inspector clip: kiểu chữ đổi ngay khi kéo để thấy chữ đổi
 * trên preview, không chờ thả chuột.
 */

export function StyleSliderRow({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
  keyframe
}: {
  label: string
  /** Nhãn cho trình đọc màn hình khi khác nhãn hiện ra (ví dụ kèm số thứ tự). */
  ariaLabel?: string
  value: number
  min: number
  max: number
  step?: number
  format(value: number): string
  onChange(value: number): void
  /** Có thì hàng mọc nút kim cương; thiếu thì hàng giữ nguyên như cũ. */
  keyframe?: KeyframeField
}): JSX.Element {
  return (
    <div className={`field-row${keyframe ? ' field-row--keyframable' : ''}`}>
      <span className="field-row__label">{label}</span>
      <div className="inspector__slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={ariaLabel ?? label}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (keyframe?.animated) keyframe.commit(next)
            else onChange(next)
          }}
        />
        <span className="field-row__value inspector__slider-value">{format(value)}</span>
      </div>
      {keyframe && <KeyframeDiamondButton field={keyframe} value={value} label={label} />}
    </div>
  )
}

export function SegmentedRow<Value extends string | number>({
  label,
  ariaLabel,
  value,
  options,
  onChange
}: {
  label: string
  ariaLabel?: string
  value: Value
  options: Array<{ value: Value; label: string }>
  onChange(value: Value): void
}): JSX.Element {
  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <div className="subtab-bar" role="radiogroup" aria-label={ariaLabel ?? label}>
        {options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`subtab ${value === option.value ? 'subtab--active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Ô chọn màu kèm mã hex, để biết đang là màu gì mà không phải mở bảng màu. */
export function ColorRow({
  label,
  ariaLabel,
  value,
  onChange
}: {
  label: string
  ariaLabel?: string
  value: string
  onChange(value: string): void
}): JSX.Element {
  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <div className="style-color">
        <input
          type="color"
          value={value.toLowerCase()}
          aria-label={ariaLabel ?? label}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <span className="field-row__value style-color__hex">{value.toUpperCase()}</span>
      </div>
    </div>
  )
}
