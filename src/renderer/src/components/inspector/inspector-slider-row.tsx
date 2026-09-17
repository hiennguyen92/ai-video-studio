import { useState, type JSX } from 'react'

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
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format(value: number): string
  onCommit(value: number): void
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? value

  return (
    <div className="field-row">
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
            onCommit(next)
          }}
        />
        <span className="field-row__value inspector__slider-value">{format(shown)}</span>
      </div>
    </div>
  )
}
