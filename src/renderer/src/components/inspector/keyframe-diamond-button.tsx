import type { JSX } from 'react'
import { useT } from '../../i18n/use-translation'
import type { KeyframeField } from './use-keyframe-field'

/**
 * Nút kim cương cạnh một ô số: chốt giá trị đang hiển thị thành keyframe tại đầu
 * phát, hoặc xoá keyframe đang đứng trên.
 *
 * Ba trạng thái nhìn thấy được, vì "có keyframe ở đâu đó" và "đang đứng trên
 * một keyframe" là hai chuyện khác nhau và người dùng cần phân biệt trước khi
 * bấm: bấm khi đang đứng trên là XOÁ, bấm ở chỗ khác là THÊM.
 */
export function KeyframeDiamondButton({
  field,
  value,
  label
}: {
  field: KeyframeField
  /** Giá trị đang hiển thị ở ô bên cạnh — đó mới là thứ người dùng thấy và muốn chốt. */
  value: number | number[]
  /** Tên thuộc tính, ghép vào nhãn cho trình đọc màn hình. */
  label: string
}): JSX.Element {
  const t = useT()
  const title = field.disabled
    ? t.inspector.keyframeOutside
    : field.state === 'on'
      ? t.inspector.keyframeRemove
      : t.inspector.keyframeAdd

  return (
    <button
      type="button"
      className={`keyframe-diamond keyframe-diamond--${field.state}`}
      // Trạng thái đọc được bằng máy, để phép thử đầu-cuối khỏi phải soi màu.
      data-state={field.state}
      disabled={field.disabled}
      title={`${title} · ${label}`}
      aria-label={`${title} · ${label}`}
      aria-pressed={field.state === 'on'}
      onClick={() => field.toggle(value)}
    />
  )
}
