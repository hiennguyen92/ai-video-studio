import { useState, type JSX } from 'react'
import { KeyframeDiamondButton } from './keyframe-diamond-button'
import type { KeyframeField } from './use-keyframe-field'

/**
 * Thanh trượt kèm số.
 *
 * Giữ giá trị "đang kéo" ở state cục bộ và chỉ gọi `onCommit` khi thả chuột, để
 * mỗi lần chỉnh chỉ tạo đúng một bước hoàn tác.
 */
export function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
  keyframe
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format(value: number): string
  onCommit(value: number): void
  /**
   * Có thì hàng mọc thêm nút kim cương, và lúc thuộc tính đang chạy keyframe
   * thì cú kéo ghi vào keyframe thay vì ghi giá trị tĩnh.
   *
   * KHÔNG bắt buộc: hầu hết hàng trong app không animate được, và chúng phải
   * giữ nguyên bố cục cũ tới từng pixel.
   */
  keyframe?: KeyframeField
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? value

  return (
    <div className={`field-row${keyframe ? ' field-row--keyframable' : ''}`}>
      <span className="field-row__label">{label}</span>
      <div className="inspector__slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          aria-label={label}
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            setDragging(null)
            // Đang chạy keyframe thì cú kéo ghi vào mốc ở đầu phát, không ghi đè
            // giá trị tĩnh — giá trị tĩnh lúc này chỉ còn là cái nền bị che.
            if (keyframe?.animated) keyframe.commit(next)
            else onCommit(next)
          }}
        />
        <span className="field-row__value inspector__slider-value">{format(shown)}</span>
      </div>
      {keyframe && <KeyframeDiamondButton field={keyframe} value={shown} label={label} />}
    </div>
  )
}
