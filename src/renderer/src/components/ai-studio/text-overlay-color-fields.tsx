import type { JSX } from 'react'
import { MAX_TEXT_OUTLINE_WIDTH_PX } from '../../../../shared/domain/subtitle-types'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'

/**
 * Màu chữ, màu viền và độ dày viền của MỘT dòng chữ đè hình.
 *
 * Đặt SAU ô nền chữ là có chủ ý: chọn khung hay hộp sẽ ghi đè màu chữ (và tắt
 * viền) cho hợp bộ, nên thứ tự đọc từ trên xuống đúng bằng thứ tự nên thao tác —
 * chọn nền trước, chỉnh màu và viền sau.
 */
export function TextOverlayColorFields({
  overlay,
  label,
  setStyle
}: {
  overlay: TextOverlay
  label: (base: string) => string
  setStyle(style: TextOverlay['style'], historyLabel: string): void
}): JSX.Element {
  const t = useT()
  const width = overlay.style.outlineWidthPx

  return (
    <>
      <label>
        <span className="field-row__label">{t.textOverlay.color}</span>
        <input
          type="color"
          value={overlay.style.color}
          aria-label={label(t.textOverlay.color)}
          onChange={(event) =>
            setStyle({ ...overlay.style, color: event.target.value.toUpperCase() }, 'Đổi màu chữ')
          }
        />
      </label>

      <label>
        <span className="field-row__label">{t.textOverlay.outlineColor}</span>
        <input
          type="color"
          value={overlay.style.outlineColor}
          aria-label={label(t.textOverlay.outlineColor)}
          onChange={(event) =>
            setStyle(
              { ...overlay.style, outlineColor: event.target.value.toUpperCase() },
              'Đổi màu viền'
            )
          }
        />
      </label>

      <div className="field-row text-overlay-item__wide">
        <span className="field-row__label">{t.textOverlay.outlineWidth}</span>
        <input
          type="range"
          min={0}
          max={MAX_TEXT_OUTLINE_WIDTH_PX}
          step={1}
          value={width}
          aria-label={label(t.textOverlay.outlineWidth)}
          onChange={(event) =>
            setStyle(
              { ...overlay.style, outlineWidthPx: Number(event.target.value) },
              'Đổi độ dày viền'
            )
          }
        />
        <span className="field-row__value">{width}px</span>
      </div>
    </>
  )
}
