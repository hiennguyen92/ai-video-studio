import type { JSX } from 'react'
import {
  SUBTITLE_STYLE_PRESETS,
  type SubtitleAlignment,
  type SubtitleStyle
} from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { FontFamilySelect } from './font-family-select'
import { TextPositionRow } from './text-position-row'

/**
 * Ô điều khiển kiểu chữ phụ đề.
 *
 * Chỉ mở ra những thuộc tính vừa hiển thị được trên preview VỪA nung được bằng
 * FFmpeg. Bày ra tuỳ chọn mà một trong hai đường không làm được sẽ dẫn tới cảnh
 * bản xuất khác hẳn bản xem trước.
 *
 * Mọi thay đổi báo lên nguyên cả style để nơi gọi ghi bằng một lệnh — một lần
 * hoàn tác trả về đúng một lần chỉnh.
 */

/** Ba vị trí hay dùng, theo hệ số bàn phím số của ASS (2 = giữa-dưới). */
const ALIGNMENTS: Array<{
  value: SubtitleAlignment
  labelKey: 'alignBottom' | 'alignMiddle' | 'alignTop'
}> = [
  { value: 2, labelKey: 'alignBottom' },
  { value: 5, labelKey: 'alignMiddle' },
  { value: 8, labelKey: 'alignTop' }
]

export function SubtitleStyleControls({
  style,
  onChange
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
}): JSX.Element {
  const t = useT()
  const patch = (changes: Partial<SubtitleStyle>): void => onChange({ ...style, ...changes })

  return (
    <div className="subtitle-style">
      <TextPositionRow style={style} onChange={onChange} />

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.rotation}</span>
        <input
          type="range"
          min={-45}
          max={45}
          step={1}
          value={style.rotationDeg ?? 0}
          aria-label={t.subtitles.rotation}
          onChange={(event) => patch({ rotationDeg: Number(event.target.value) })}
        />
        <span className="field-row__value">{style.rotationDeg ?? 0}°</span>
      </div>

      <FontFamilySelect
        family={style.fontFamily}
        postScriptName={style.fontPostScriptName}
        onChange={(next) => patch(next)}
      />

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.preset}</span>
        <select
          aria-label={t.subtitles.preset}
          // Preset chỉ là điểm khởi đầu, không phải trạng thái được giữ lại —
          // người dùng chỉnh tiếp sau đó nên không ô nào còn "đang chọn" nữa.
          value=""
          onChange={(event) => {
            const preset = SUBTITLE_STYLE_PRESETS.find((item) => item.id === event.target.value)
            if (preset) patch(preset.style)
          }}
        >
          <option value="">—</option>
          {SUBTITLE_STYLE_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.fontSize}</span>
        <input
          type="number"
          min={12}
          max={200}
          value={style.fontSizePx}
          aria-label={t.subtitles.fontSize}
          onChange={(event) =>
            patch({ fontSizePx: Number(event.target.value) || style.fontSizePx })
          }
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.color}</span>
        <input
          type="color"
          value={style.color}
          aria-label={t.subtitles.color}
          onChange={(event) => patch({ color: event.target.value.toUpperCase() })}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.outlineColor}</span>
        <input
          type="color"
          value={style.outlineColor}
          aria-label={t.subtitles.outlineColor}
          onChange={(event) => patch({ outlineColor: event.target.value.toUpperCase() })}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.outlineWidth}</span>
        <input
          type="range"
          min={0}
          max={8}
          step={1}
          value={style.outlineWidthPx}
          aria-label={t.subtitles.outlineWidth}
          onChange={(event) => patch({ outlineWidthPx: Number(event.target.value) })}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.boxOpacity}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(style.boxOpacity * 100)}
          aria-label={t.subtitles.boxOpacity}
          onChange={(event) => patch({ boxOpacity: Number(event.target.value) / 100 })}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.alignment}</span>
        <select
          value={style.alignment}
          aria-label={t.subtitles.alignment}
          onChange={(event) =>
            patch({ alignment: Number(event.target.value) as SubtitleAlignment })
          }
        >
          {ALIGNMENTS.map((option) => (
            <option key={option.value} value={option.value}>
              {t.subtitles[option.labelKey]}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.marginVertical}</span>
        <input
          type="number"
          min={0}
          max={600}
          value={style.marginVerticalPx}
          aria-label={t.subtitles.marginVertical}
          onChange={(event) => patch({ marginVerticalPx: Number(event.target.value) || 0 })}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.maxChars}</span>
        <input
          type="number"
          min={12}
          max={100}
          value={style.maxCharsPerLine}
          aria-label={t.subtitles.maxChars}
          onChange={(event) =>
            patch({ maxCharsPerLine: Number(event.target.value) || style.maxCharsPerLine })
          }
        />
      </div>
    </div>
  )
}
