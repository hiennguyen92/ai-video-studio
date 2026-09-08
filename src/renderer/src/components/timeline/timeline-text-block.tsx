import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { TextBlockDragMode } from '../../../../shared/domain/text-block-drag'
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

/** Bề rộng vùng bắt chuột để kéo mép, giống hệt clip. */
const TRIM_HANDLE_PX = 7

export function TimelineTextBlock({
  item,
  variant,
  pixelsPerSecond,
  active,
  selected,
  dragging,
  onSelect,
  onPointerDown
}: {
  item: TimelineTextBlockItem
  variant: TextBlockVariant
  pixelsPerSecond: number
  /** Đầu phát đang nằm trong khoảng của khối này. */
  active: boolean
  /**
   * Đang là khối được chọn, tức panel thuộc tính bên phải đang nói về nó.
   *
   * Khác `active`: `active` chỉ nói đầu phát đang đi qua đây. Không phân biệt
   * hai thứ thì người dùng sửa nhầm khối mà vẫn tưởng đang sửa khối mình bấm.
   */
  selected: boolean
  /** Đang được kéo — tắt hiệu ứng chuyển động cho khối bám theo chuột. */
  dragging: boolean
  onSelect(item: TimelineTextBlockItem): void
  onPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    item: TimelineTextBlockItem,
    mode: TextBlockDragMode
  ): void
}): JSX.Element {
  const left = usToPx(item.startUs, pixelsPerSecond)
  const width = usToPx(item.endUs - item.startUs, pixelsPerSecond)

  // Khối quá hẹp thì hai tay cầm ăn hết chỗ và không còn cách nào dời cả khối;
  // lúc đó chỉ cho dời, bỏ hẳn phần cắt mép.
  const showHandles = width > TRIM_HANDLE_PX * 3

  return (
    <div
      className={[
        'timeline-text-block',
        `timeline-text-block--${variant}`,
        active ? 'timeline-text-block--active' : '',
        selected ? 'timeline-text-block--selected' : '',
        dragging ? 'timeline-text-block--dragging' : '',
        item.edited ? 'timeline-text-block--edited' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      // Khối rất hẹp vẫn phải nhìn thấy được; câu nửa giây không được biến mất.
      style={{ left, width: Math.max(width, 3) }}
      // Nội dung đầy đủ trong tooltip: câu dài hơn bề rộng khối thì trên hình chỉ
      // còn vài chữ, mà đúng lúc đó mới cần đọc cả câu.
      title={item.text}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={item.text}
      onPointerDown={(event) => {
        // Lấy tiêu điểm về khối. Lớp kéo gọi `preventDefault()` nên trình duyệt
        // không tự chuyển tiêu điểm, và nó kẹt lại ở ô nhập vừa gõ — lúc đó Ctrl+Z
        // bị phím tắt bỏ qua vì tưởng người dùng đang gõ chữ.
        event.currentTarget.focus()
        onPointerDown(event, item, 'move')
      }}
      onClick={() => onSelect(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(item)
        }
      }}
    >
      <span className="timeline-text-block__text">{item.text}</span>

      {showHandles && (
        <>
          <span
            className="timeline-text-block__handle timeline-text-block__handle--start"
            aria-hidden="true"
            onPointerDown={(event) => {
              event.currentTarget.parentElement?.focus()
              onPointerDown(event, item, 'trim-start')
            }}
          />
          <span
            className="timeline-text-block__handle timeline-text-block__handle--end"
            aria-hidden="true"
            onPointerDown={(event) => {
              event.currentTarget.parentElement?.focus()
              onPointerDown(event, item, 'trim-end')
            }}
          />
        </>
      )}
    </div>
  )
}
