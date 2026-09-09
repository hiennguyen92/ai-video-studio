import type { JSX } from 'react'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Hàng hiện vị trí tự do, kèm nút bỏ ghim.
 *
 * Kéo chữ trên khung xem trước sẽ GHIM nó vào một điểm, và từ lúc đó ô chọn vị
 * trí cùng ba con số lề không còn tác dụng. Không có hàng này thì người dùng
 * chỉnh lề mãi mà chữ không nhúc nhích, và chẳng có gì nói cho họ biết vì sao.
 *
 * Không ghim thì không hiện gì cả — một hàng "chưa ghim" chỉ là nhiễu.
 */

export function TextPositionRow({
  style,
  onChange
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
}): JSX.Element | null {
  const t = useT()
  if (!style.position) return null

  return (
    <div className="field-row">
      <span className="field-row__label">{t.subtitles.pinnedPosition}</span>
      <span className="field-row__value">
        {Math.round(style.position.xPct * 100)}% · {Math.round(style.position.yPct * 100)}%
      </span>
      <ToolButton
        label={t.subtitles.unpinPosition}
        variant="outline"
        onClick={() => {
          // Xoá hẳn trường chứ không đặt về giữa khung: bỏ ghim nghĩa là trả chữ
          // về cho alignment và lề quyết định.
          const next = { ...style }
          delete next.position
          onChange(next)
        }}
      />
    </div>
  )
}
