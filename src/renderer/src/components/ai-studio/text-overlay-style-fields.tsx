import type { JSX } from 'react'
import {
  type TextAnimation,
  type TextExitAnimation,
  type TextOverlay
} from '../../../../shared/domain/text-overlay-types'
import type { SubtitleAlignment } from '../../../../shared/domain/subtitle-types'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { FontFamilySelect } from './font-family-select'
import { TextPositionRow } from './text-position-row'
import { TextOverlayFrameFields } from './text-overlay-frame-fields'

/**
 * Các ô chỉnh kiểu cho MỘT dòng chữ đè hình.
 *
 * Tách riêng vì cùng bộ ô này xuất hiện ở hai chỗ: danh sách trong tab Phụ đề, và
 * panel thuộc tính khi bấm vào khối chữ trên timeline. Chép làm hai bản thì thêm
 * một tuỳ chọn ở đây sẽ lặng lẽ thiếu ở kia.
 */

const ANIMATIONS: Array<{ value: TextAnimation; labelKey: string }> = [
  { value: 'none', labelKey: 'animationNone' },
  { value: 'fade', labelKey: 'animationFade' },
  { value: 'pop', labelKey: 'animationPop' },
  { value: 'slide-up', labelKey: 'animationSlideUp' },
  { value: 'typewriter', labelKey: 'animationTypewriter' }
]

const EXITS: Array<{ value: TextExitAnimation; labelKey: string }> = [
  { value: 'none', labelKey: 'exitNone' },
  { value: 'fade', labelKey: 'exitFade' },
  { value: 'shrink', labelKey: 'exitShrink' },
  { value: 'slide-down', labelKey: 'exitSlideDown' }
]

/** Vị trí theo hệ số bàn phím số của ASS, gói lại thành ba lựa chọn dễ hiểu. */
const POSITIONS: Array<{ value: SubtitleAlignment; labelKey: string }> = [
  { value: 8, labelKey: 'positionTop' },
  { value: 5, labelKey: 'positionMiddle' },
  { value: 2, labelKey: 'positionBottom' }
]

export function TextOverlayStyleFields({
  overlay,
  index
}: {
  overlay: TextOverlay
  /**
   * Số thứ tự trong danh sách, chỉ để phân biệt nhãn cho trình đọc màn hình.
   * Bỏ trống khi trên màn chỉ có một dòng chữ — lúc đó thêm số vào là nhiễu.
   */
  index?: number
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const label = (base: string): string => (index === undefined ? base : `${base} ${index + 1}`)

  const setStyle = (style: TextOverlay['style'], historyLabel: string): void => {
    run([{ type: 'text/set-style', overlayId: overlay.id, style }], historyLabel)
  }

  return (
    <>
      <TextPositionRow style={overlay.style} onChange={(style) => setStyle(style, 'Bỏ ghim chữ')} />

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.rotation}</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={overlay.style.rotationDeg ?? 0}
          aria-label={label(t.subtitles.rotation)}
          onChange={(event) =>
            setStyle({ ...overlay.style, rotationDeg: Number(event.target.value) }, 'Xoay chữ')
          }
        />
        <span className="field-row__value">{overlay.style.rotationDeg ?? 0}°</span>
      </div>

      <FontFamilySelect
        family={overlay.style.fontFamily}
        postScriptName={overlay.style.fontPostScriptName}
        onChange={(next) => setStyle({ ...overlay.style, ...next }, 'Đổi phông chữ')}
      />

      <div className="text-overlay-item__row">
        <label>
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
                'Đổi hiệu ứng chữ'
              )
            }
          >
            {ANIMATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span className="field-row__label">{t.textOverlay.position}</span>
          <select
            value={overlay.style.alignment}
            aria-label={label(t.textOverlay.position)}
            onChange={(event) =>
              setStyle(
                {
                  ...overlay.style,
                  alignment: Number(event.target.value) as SubtitleAlignment,
                  // Nằm giữa thì lề dọc vô nghĩa; đặt lại để chữ không lệch.
                  marginVerticalPx: Number(event.target.value) === 5 ? 0 : 160
                },
                'Đổi vị trí chữ'
              )
            }
          >
            {POSITIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
              </option>
            ))}
          </select>
        </label>

        <label>
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
                'Đổi hiệu ứng ra'
              )
            }
          >
            {EXITS.map((option) => (
              <option key={option.value} value={option.value}>
                {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
              </option>
            ))}
          </select>
        </label>

        <label className="text-overlay-item__toggle">
          <input
            type="checkbox"
            checked={overlay.glow ?? false}
            aria-label={label(t.textOverlay.glow)}
            onChange={(event) =>
              run(
                [{ type: 'text/update', overlayId: overlay.id, glow: event.target.checked }],
                'Đổi viền phát sáng'
              )
            }
          />
          <span className="field-row__label">{t.textOverlay.glow}</span>
        </label>

        <TextOverlayFrameFields overlay={overlay} label={label} />

        {/*
          Đặt SAU ô nền chữ là có chủ ý: chọn khung hay hộp sẽ ghi đè màu chữ cho
          hợp bộ, nên thứ tự đọc từ trên xuống đúng bằng thứ tự nên thao tác —
          chọn nền trước, chỉnh màu sau.
        */}
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

        <label>
          <span className="field-row__label">{t.textOverlay.fontSize}</span>
          <input
            type="number"
            min={12}
            max={300}
            value={overlay.style.fontSizePx}
            aria-label={label(t.textOverlay.fontSize)}
            onChange={(event) =>
              setStyle(
                {
                  ...overlay.style,
                  fontSizePx: Number(event.target.value) || overlay.style.fontSizePx
                },
                'Đổi cỡ chữ'
              )
            }
          />
        </label>
      </div>
    </>
  )
}
