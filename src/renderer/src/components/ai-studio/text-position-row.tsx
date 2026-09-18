import type { JSX } from 'react'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { KeyframeDiamondButton } from '../inspector/keyframe-diamond-button'
import type { KeyframeField } from '../inspector/use-keyframe-field'

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
  onChange,
  keyframe
}: {
  style: SubtitleStyle
  onChange(next: SubtitleStyle): void
  /**
   * Nút chốt vị trí hiện tại thành keyframe.
   *
   * Nằm ở hàng này chứ không phải một hàng riêng vì nó chỉ có nghĩa khi chữ đã
   * ghim — chữ chưa ghim thì vị trí do alignment và lề quyết định, và "keyframe
   * cho một thứ được tính ra" là câu không có nghĩa.
   */
  keyframe?: KeyframeField
}): JSX.Element | null {
  const t = useT()
  if (!style.position) return null

  return (
    <div className="field-row">
      <span className="field-row__label">{t.subtitles.pinnedPosition}</span>
      <span className="field-row__value">
        {Math.round(style.position.xPct * 100)}% · {Math.round(style.position.yPct * 100)}%
      </span>
      {keyframe && (
        <KeyframeDiamondButton
          field={keyframe}
          value={[style.position.xPct, style.position.yPct]}
          label={t.subtitles.pinnedPosition}
        />
      )}
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
