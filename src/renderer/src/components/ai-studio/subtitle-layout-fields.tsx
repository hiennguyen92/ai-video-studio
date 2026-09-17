import type { JSX } from 'react'
import type { SubtitleAlignment, SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import { MAX_TEXT_ROTATION_DEG } from '../../../../shared/domain/text-placement'
import { useT } from '../../i18n/use-translation'
import { SegmentedRow, StyleSliderRow } from './style-field-rows'
import { TextPositionRow } from './text-position-row'

/**
 * Bố cục phụ đề: vị trí, lề, ngắt dòng, góc xoay.
 *
 * Kéo chữ trên preview sẽ GHIM nó vào một điểm; lúc đó vị trí và lề không còn tác
 * dụng — hàng ghim đứng đầu để nói ra điều đó và bỏ ghim được ngay, và hai ô bị
 * ghim đè thì làm mờ đi.
 */
export function SubtitleLayoutFields({
  style,
  onChange
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
}): JSX.Element {
  const t = useT()
  const patch = (changes: Partial<SubtitleStyle>): void => onChange({ ...style, ...changes })
  const pinned = Boolean(style.position)

  return (
    <>
      <TextPositionRow style={style} onChange={onChange} />

      <div className={pinned ? 'style-fields--overridden' : undefined}>
        <SegmentedRow<SubtitleAlignment>
          label={t.subtitles.alignment}
          value={style.alignment}
          options={[
            { value: 8, label: t.subtitles.alignTop },
            { value: 5, label: t.subtitles.alignMiddle },
            { value: 2, label: t.subtitles.alignBottom }
          ]}
          onChange={(alignment) => patch({ alignment })}
        />
        <StyleSliderRow
          label={t.subtitles.marginVertical}
          value={style.marginVerticalPx}
          min={0}
          max={600}
          step={2}
          format={(value) => `${value}px`}
          onChange={(value) => patch({ marginVerticalPx: value })}
        />
      </div>

      <StyleSliderRow
        label={t.subtitles.maxChars}
        value={style.maxCharsPerLine}
        min={12}
        max={100}
        format={(value) => String(value)}
        onChange={(value) => patch({ maxCharsPerLine: value })}
      />
      <StyleSliderRow
        label={t.subtitles.rotation}
        value={style.rotationDeg ?? 0}
        min={-MAX_TEXT_ROTATION_DEG}
        max={MAX_TEXT_ROTATION_DEG}
        format={(value) => `${value}°`}
        onChange={(value) => patch({ rotationDeg: value })}
      />
    </>
  )
}
