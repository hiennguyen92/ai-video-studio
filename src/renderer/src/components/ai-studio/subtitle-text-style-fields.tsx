import type { JSX } from 'react'
import {
  MAX_TEXT_OUTLINE_WIDTH_PX,
  SUBTITLE_STYLE_PRESETS,
  type SubtitleStyle
} from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { FontFamilySelect } from './font-family-select'
import { ColorRow, StyleSliderRow } from './style-field-rows'

/**
 * Kiểu CHỮ của phụ đề: mẫu, phông, cỡ, màu; viền & bóng; nền chữ.
 *
 * Chỉ bày thuộc tính mà preview VÀ bản nung FFmpeg cùng vẽ được — lệch một bên là
 * bản xuất khác bản xem trước. Mọi thay đổi báo lên nguyên style để nơi gọi ghi
 * một lệnh, một bước hoàn tác.
 */
export function SubtitleTextStyleFields({
  style,
  onChange
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
}): JSX.Element {
  const t = useT()
  const patch = (changes: Partial<SubtitleStyle>): void => onChange({ ...style, ...changes })

  return (
    <>
      <div className="field-row">
        <span className="field-row__label">{t.subtitles.preset}</span>
        <select
          aria-label={t.subtitles.preset}
          // Mẫu chỉ là điểm khởi đầu: chỉnh tiếp là không còn "đang chọn" mẫu nào.
          value=""
          onChange={(event) => {
            const preset = SUBTITLE_STYLE_PRESETS.find((item) => item.id === event.target.value)
            if (preset) patch(preset.style)
          }}
        >
          <option value="">{t.subtitles.presetPick}</option>
          {SUBTITLE_STYLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      <p className="field-group__title">{t.subtitles.textGroup}</p>
      <FontFamilySelect
        family={style.fontFamily}
        postScriptName={style.fontPostScriptName}
        onChange={(next) => patch(next)}
      />
      <StyleSliderRow
        label={t.subtitles.fontSize}
        value={style.fontSizePx}
        min={12}
        max={200}
        format={(value) => `${value}px`}
        onChange={(value) => patch({ fontSizePx: value })}
      />
      <ColorRow
        label={t.subtitles.color}
        value={style.color}
        onChange={(color) => patch({ color })}
      />

      <p className="field-group__title">{t.subtitles.outlineGroup}</p>
      <ColorRow
        label={t.subtitles.outlineColor}
        value={style.outlineColor}
        onChange={(outlineColor) => patch({ outlineColor })}
      />
      <StyleSliderRow
        label={t.subtitles.outlineWidth}
        value={style.outlineWidthPx}
        min={0}
        max={MAX_TEXT_OUTLINE_WIDTH_PX}
        format={(value) => `${value}px`}
        onChange={(value) => patch({ outlineWidthPx: value })}
      />
      <StyleSliderRow
        label={t.subtitles.shadow}
        value={style.shadowPx}
        min={0}
        max={10}
        format={(value) => `${value}px`}
        onChange={(value) => patch({ shadowPx: value })}
      />

      <p className="field-group__title">{t.subtitles.boxGroup}</p>
      <StyleSliderRow
        label={t.subtitles.boxOpacity}
        value={Math.round(style.boxOpacity * 100)}
        min={0}
        max={100}
        step={5}
        format={(value) => (value === 0 ? t.subtitles.boxOff : `${value}%`)}
        onChange={(value) => patch({ boxOpacity: value / 100 })}
      />
      {/* Nền tắt thì màu nền không có tác dụng gì: không bày ra. */}
      {style.boxOpacity > 0 && (
        <ColorRow
          label={t.subtitles.boxColor}
          value={style.boxColor}
          onChange={(boxColor) => patch({ boxColor })}
        />
      )}
    </>
  )
}
