import type { JSX } from 'react'
import { MAX_TEXT_OUTLINE_WIDTH_PX } from '../../../../shared/domain/subtitle-types'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { FontFamilySelect } from './font-family-select'
import { ColorRow, StyleSliderRow } from './style-field-rows'
import { useKeyframeField } from '../inspector/use-keyframe-field'
import { TextOverlayFrameFields } from './text-overlay-frame-fields'

/**
 * Tab Style của một chữ: phông, cỡ; nền & khung; màu & viền.
 *
 * "Nền & khung" đứng TRƯỚC "Màu & viền" là có chủ ý: chọn khung hay hộp sẽ đặt lại
 * màu chữ (và tắt viền) cho hợp bộ, nên thứ tự đọc từ trên xuống đúng bằng thứ tự
 * nên thao tác — chọn nền trước, chỉnh màu sau.
 */
export function TextOverlayStyleFields({
  overlay,
  label
}: {
  overlay: TextOverlay
  label(base: string): string
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const style = overlay.style
  const fontSizeKeyframe = useKeyframeField(
    { kind: 'text', overlayId: overlay.id },
    ['style.fontSizePx'],
    t.subtitles.fontSize
  )
  const setStyle = (changes: Partial<TextOverlay['style']>, historyLabel: string): void => {
    run(
      [{ type: 'text/set-style', overlayId: overlay.id, style: { ...style, ...changes } }],
      historyLabel
    )
  }

  return (
    <>
      <FontFamilySelect
        family={style.fontFamily}
        postScriptName={style.fontPostScriptName}
        onChange={(next) => setStyle(next, 'Đổi phông chữ')}
      />
      <StyleSliderRow
        label={t.textOverlay.fontSize}
        ariaLabel={label(t.textOverlay.fontSize)}
        value={style.fontSizePx}
        min={12}
        max={300}
        format={(value) => `${value}px`}
        onChange={(value) => setStyle({ fontSizePx: value }, 'Đổi cỡ chữ')}
        keyframe={fontSizeKeyframe}
      />

      <p className="field-group__title">{t.textOverlay.backgroundGroup}</p>
      <TextOverlayFrameFields overlay={overlay} label={label} />

      <p className="field-group__title">{t.textOverlay.colorGroup}</p>
      <ColorRow
        label={t.textOverlay.color}
        ariaLabel={label(t.textOverlay.color)}
        value={style.color}
        onChange={(color) => setStyle({ color }, 'Đổi màu chữ')}
      />
      <ColorRow
        label={t.textOverlay.outlineColor}
        ariaLabel={label(t.textOverlay.outlineColor)}
        value={style.outlineColor}
        onChange={(outlineColor) => setStyle({ outlineColor }, 'Đổi màu viền')}
      />
      <StyleSliderRow
        label={t.textOverlay.outlineWidth}
        ariaLabel={label(t.textOverlay.outlineWidth)}
        value={style.outlineWidthPx}
        min={0}
        max={MAX_TEXT_OUTLINE_WIDTH_PX}
        format={(value) => `${value}px`}
        onChange={(value) => setStyle({ outlineWidthPx: value }, 'Đổi độ dày viền')}
      />
      <label className="field-row style-toggle">
        <span className="field-row__label">{t.textOverlay.glow}</span>
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
      </label>
    </>
  )
}
