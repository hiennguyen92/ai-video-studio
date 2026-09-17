import type { ButtonHTMLAttributes, JSX, ReactNode } from 'react'

/**
 * Nút dùng chung.
 *
 * Nút chỉ có icon luôn có tooltip (`data-tooltip`, vẽ bởi `TooltipLayer`) — DESCRIPTION
 * §2 yêu cầu có tooltip, và nút icon không nhãn mà thiếu tooltip thì không đoán được.
 * Nút chỉ-icon còn nhận thêm `aria-label` để trình đọc màn hình đọc được.
 */

type Variant = 'ghost' | 'primary' | 'outline' | 'danger'

interface ToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  label: string
  icon?: ReactNode
  variant?: Variant
  active?: boolean
  /** Chỉ hiện icon, nhãn chuyển thành tooltip. */
  iconOnly?: boolean
}

const VARIANT_CLASS: Record<Variant, string> = {
  ghost: '',
  primary: 'button--primary',
  outline: 'button--outline',
  danger: 'button--danger'
}

export function ToolButton({
  label,
  icon,
  variant = 'ghost',
  active = false,
  iconOnly = false,
  className,
  ...rest
}: ToolButtonProps): JSX.Element {
  const classes = [
    'button',
    VARIANT_CLASS[variant],
    iconOnly ? 'button--icon' : '',
    active ? 'button--active' : '',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      // Nút chỉ có icon: tooltip riêng của app (hiện nhanh, có chip phím tắt). Nút có
      // chữ thì nhãn đã nằm sẵn trên nút, chỉ giữ `title` cho trường hợp chữ bị cắt.
      title={iconOnly ? undefined : label}
      data-tooltip={iconOnly ? label : undefined}
      aria-label={iconOnly ? label : undefined}
      aria-pressed={active || undefined}
      {...rest}
    >
      {icon}
      {!iconOnly && <span>{label}</span>}
    </button>
  )
}
