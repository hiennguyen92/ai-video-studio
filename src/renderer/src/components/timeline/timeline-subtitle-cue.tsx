import type { JSX } from 'react'
import type { SubtitleCue } from '../../../../shared/domain/subtitle-types'
import { usToPx } from './timeline-geometry'

/**
 * Một câu phụ đề trên timeline.
 *
 * Phụ đề KHÔNG phải clip: cue nằm trong `document.subtitleTracks`, không nằm
 * trong `track.clips`. Nên lane phụ đề trước đây luôn rỗng — người dùng thấy một
 * hàng trống và không biết câu nào nằm ở đâu, dài bao lâu, hay chỗ nào bị hở.
 *
 * Vẽ riêng thay vì nhét cue thành clip giả: clip có tài sản nguồn, tốc độ phát,
 * fade, chuyển cảnh — phụ đề không có gì trong số đó, và nhét vào sẽ mở đường cho
 * những thao tác vô nghĩa như "đặt chuyển cảnh cho một câu phụ đề".
 */

export function TimelineSubtitleCue({
  cue,
  pixelsPerSecond,
  selected,
  onSelect
}: {
  cue: SubtitleCue
  pixelsPerSecond: number
  selected: boolean
  onSelect(cue: SubtitleCue): void
}): JSX.Element {
  const left = usToPx(cue.startUs, pixelsPerSecond)
  const width = usToPx(cue.endUs - cue.startUs, pixelsPerSecond)

  return (
    <button
      type="button"
      className={`timeline-cue ${selected ? 'timeline-cue--selected' : ''} ${
        cue.edited ? 'timeline-cue--edited' : ''
      }`}
      style={{ left, width: Math.max(width, 2) }}
      // Nội dung đầy đủ trong tooltip: câu dài hơn bề rộng khối thì trên hình chỉ
      // còn vài chữ, mà đúng lúc đó mới cần đọc cả câu.
      title={cue.text}
      aria-label={cue.text}
      onClick={() => onSelect(cue)}
    >
      <span className="timeline-cue__text">{cue.text}</span>
    </button>
  )
}
