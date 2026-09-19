import type { JSX } from 'react'
import {
  NEUTRAL_COLOR_GRADE,
  isNeutralColorGrade,
  type ClipColorGrade
} from '../../../../shared/domain/clip-color-grade'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Chỉnh màu clip đang chọn.
 *
 * Năm thanh trượt chỉnh tay. Look màu dựng sẵn (tab LUT) nằm ở mục riêng ngay
 * trên, áp SAU phần chỉnh này. File `.cube` tuỳ ý vẫn chưa nhận: bảng tra ba chiều
 * không dựng đúng bằng bộ lọc SVG, làm đúng phải đẩy từng khung qua shader.
 */

const SLIDERS: Array<{
  key: keyof ClipColorGrade
  labelKey: string
  min: number
  max: number
}> = [
  { key: 'brightness', labelKey: 'colorBrightness', min: 0.5, max: 1.5 },
  { key: 'contrast', labelKey: 'colorContrast', min: 0.5, max: 1.5 },
  { key: 'saturation', labelKey: 'colorSaturation', min: 0, max: 2 },
  { key: 'temperature', labelKey: 'colorTemperature', min: -1, max: 1 },
  { key: 'vignette', labelKey: 'colorVignette', min: 0, max: 1 }
]

export function ClipColorControls({
  clip,
  onChange
}: {
  clip: Clip
  onChange(grade: Partial<ClipColorGrade> | undefined): void
}): JSX.Element {
  const t = useT()
  const grade = clip.colorGrade ?? NEUTRAL_COLOR_GRADE

  return (
    <>
      <p className="field-group__title">{t.inspector.color}</p>

      {SLIDERS.map((slider) => (
        <div key={slider.key} className="field-row">
          <span className="field-row__label">
            {t.inspector[slider.labelKey as keyof typeof t.inspector] as string}
          </span>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={0.01}
            value={grade[slider.key]}
            aria-label={t.inspector[slider.labelKey as keyof typeof t.inspector] as string}
            onChange={(event) => onChange({ [slider.key]: Number(event.target.value) })}
          />
          <span className="field-row__value">{grade[slider.key].toFixed(2)}</span>
        </div>
      ))}

      <div className="field-row">
        <ToolButton
          label={t.inspector.colorReset}
          variant="outline"
          disabled={isNeutralColorGrade(clip.colorGrade)}
          onClick={() => onChange(undefined)}
        />
      </div>

      <p className="inspector__hint">{t.inspector.colorNoLutNote}</p>
    </>
  )
}
