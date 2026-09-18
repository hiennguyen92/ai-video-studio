import { valueAtFrame } from './keyframe-interpolation'
import { alignmentPosition } from './text-placement'
import type { ResolvedKeyframeTracks } from './keyframe-types'
import type { SubtitleStyle } from './subtitle-types'

/** Bốn thuộc tính chữ đặt keyframe được, gom một chỗ để chỗ đọc khỏi đoán. */
const X_PCT = 'style.position.xPct'
const Y_PCT = 'style.position.yPct'
const FONT_SIZE = 'style.fontSizePx'
const ROTATION = 'style.rotationDeg'

/**
 * Kiểu chữ của một khối overlay TẠI một khung hình.
 *
 * Chỉ ba thứ chạy được: vị trí, cỡ chữ, góc xoay. Màu, phông, viền đứng ngoài vì
 * chúng không có "giá trị ở giữa" nào có nghĩa — cùng lý do với thông số màu của
 * effect.
 *
 * Hiệu ứng vào/ra KHÔNG đi qua đây. Chúng vẫn là một lớp nhân/nối chồng lên kết
 * quả này ở lớp vẽ, nên chữ trượt ngang bằng keyframe mà vẫn mờ dần vào ở đầu —
 * hai thứ độc lập, đúng như người dùng trông đợi.
 */
export function textStyleAt(
  keyframes: ResolvedKeyframeTracks | undefined,
  frame: number,
  style: SubtitleStyle
): SubtitleStyle {
  if (!keyframes) return style

  const xTrack = keyframes[X_PCT]
  const yTrack = keyframes[Y_PCT]
  const sizeTrack = keyframes[FONT_SIZE]
  const rotationTrack = keyframes[ROTATION]
  // Khối chữ có keyframe ở thuộc tính khác (chưa có ở bản này, nhưng bảng là
  // chung) thì vẫn phải nhận lại chính object cũ.
  if (!xTrack && !yTrack && !sizeTrack && !rotationTrack) return style

  // Chữ chưa ghim vị trí thì nền là chỗ alignment đang đặt nó, không phải góc
  // trên-trái. Và chỉ cần một trong hai trục có keyframe là phải ghim cả cặp:
  // `position` là một thể thống nhất, thiếu một nửa thì lớp vẽ quay về neo theo
  // alignment và trục kia coi như không có tác dụng.
  const base = style.position ?? alignmentPosition(style.alignment)
  const position =
    xTrack || yTrack
      ? {
          xPct: valueAtFrame(xTrack, frame, base.xPct),
          yPct: valueAtFrame(yTrack, frame, base.yPct)
        }
      : style.position

  return {
    ...style,
    position,
    fontSizePx: valueAtFrame(sizeTrack, frame, style.fontSizePx),
    rotationDeg: valueAtFrame(rotationTrack, frame, style.rotationDeg ?? 0)
  }
}
