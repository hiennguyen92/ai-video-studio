import type { JSX } from 'react'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { SubtitleLayoutFields } from './subtitle-layout-fields'
import { SubtitleTextStyleFields } from './subtitle-text-style-fields'

/**
 * Toàn bộ kiểu phụ đề trên một cột, cho tab Phụ đề của AI Studio. Panel Thuộc tính
 * dùng lại hai phần này nhưng tách vào tab con Text và Layout.
 */
export function SubtitleStyleControls({
  style,
  onChange
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
}): JSX.Element {
  const t = useT()
  return (
    <div className="subtitle-style">
      <SubtitleTextStyleFields style={style} onChange={onChange} />
      <p className="field-group__title">{t.subtitles.layoutGroup}</p>
      <SubtitleLayoutFields style={style} onChange={onChange} />
    </div>
  )
}
