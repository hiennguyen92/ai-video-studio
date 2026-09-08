import type { JSX, ReactNode } from 'react'

/**
 * Trạng thái rỗng.
 *
 * DESCRIPTION §2 yêu cầu có "hướng dẫn khi chưa có dữ liệu", nên thành phần này
 * luôn bắt buộc phải có `hint` — một panel trống chỉ ghi "Không có dữ liệu" thì
 * người dùng không biết phải làm gì tiếp.
 */
export function EmptyState({
  title,
  hint,
  action
}: {
  title: string
  hint: string
  action?: ReactNode
}): JSX.Element {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__hint">{hint}</p>
      {action}
    </div>
  )
}
