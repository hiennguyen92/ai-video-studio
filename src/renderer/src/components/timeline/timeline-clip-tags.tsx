import type { JSX } from 'react'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useClipTagDescriptions } from './use-clip-tag-descriptions'

/**
 * Nhãn LUT, Zoom và effect xếp dọc dưới tên clip trên timeline, để nhìn là biết clip nào đã
 * áp gì mà không phải chọn từng clip mở Inspector. Effect cùng loại gộp thành ×2, ×3;
 * nhiều loại effect gom thành một nhãn "Effect ×N".
 *
 * Nhãn không bắt chuột: kéo, cắt mép và thả thẻ Library lên clip vẫn đi qua clip.
 * Vì thế nhãn không có tooltip riêng; clip hẹp làm nhãn bị cắt thì tên đầy đủ nằm
 * trong tooltip của chính clip (`useClipTagDescriptions`).
 */
export function TimelineClipTags({ clip }: { clip: Clip }): JSX.Element | null {
  const described = useClipTagDescriptions(clip, { collapseEffects: true })
  if (described.length === 0) return null
  return (
    <div className="timeline-clip__tags">
      {described.map(({ tag, text, full }) => (
        <span
          key={`${tag.category}-${tag.key}`}
          className={`timeline-clip__tag timeline-clip__tag--${tag.category}`}
          data-tag-category={tag.category}
          aria-label={full}
        >
          {text}
        </span>
      ))}
    </div>
  )
}
