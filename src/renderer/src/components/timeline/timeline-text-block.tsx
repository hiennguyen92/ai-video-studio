import type { JSX } from 'react'
import { usToPx } from './timeline-geometry'

/**
 * Một khối chữ trên timeline: câu phụ đề, hoặc chữ đè lên hình.
 *
 * Cả hai đều KHÔNG phải clip. Cue phụ đề nằm trong `document.subtitleTracks`,
 * chữ overlay nằm trong `document.textOverlays` — mà timeline chỉ vẽ
 * `track.clips`. Thiếu lớp này thì cả hai loại chữ đều vô hình trên timeline:
 * người dùng không biết câu nào nằm ở đâu, dài bao lâu, hay chỗ nào bị hở.
 *
 * Vẽ riêng thay vì nhét chúng thành clip giả: clip có tài sản nguồn, tốc độ
 * phát, fade, chuyển cảnh — chữ không có gì trong số đó, và nhét vào sẽ mở đường
 * cho những thao tác vô nghĩa như "đặt chuyển cảnh cho một câu phụ đề".
 */

export type TextBlockVariant = 'subtitle' | 'overlay'

export interface TimelineTextBlockItem {
  id: string
  startUs: number
  endUs: number
  text: string
  /** Câu phụ đề đã sửa tay — đánh dấu để dựng lại không xoá nhầm công sức. */
  edited?: boolean
}

export function TimelineTextBlock({
  item,
  variant,
  pixelsPerSecond,
  active,
  onSelect
}: {
  item: TimelineTextBlockItem
  variant: TextBlockVariant
  pixelsPerSecond: number
  /** Đầu phát đang nằm trong khoảng của khối này. */
  active: boolean
  onSelect(item: TimelineTextBlockItem): void
}): JSX.Element {
  const left = usToPx(item.startUs, pixelsPerSecond)
  const width = usToPx(item.endUs - item.startUs, pixelsPerSecond)

  return (
    <button
      type="button"
      className={[
        'timeline-text-block',
        `timeline-text-block--${variant}`,
        active ? 'timeline-text-block--active' : '',
        item.edited ? 'timeline-text-block--edited' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      // Khối rất hẹp vẫn phải nhìn thấy được; câu nửa giây không được biến mất.
      style={{ left, width: Math.max(width, 3) }}
      // Nội dung đầy đủ trong tooltip: câu dài hơn bề rộng khối thì trên hình chỉ
      // còn vài chữ, mà đúng lúc đó mới cần đọc cả câu.
      title={item.text}
      aria-label={item.text}
      onClick={() => onSelect(item)}
    >
      <span className="timeline-text-block__text">{item.text}</span>
    </button>
  )
}
