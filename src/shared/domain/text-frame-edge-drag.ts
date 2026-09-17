import { clampTextFramePaddingScale } from './text-overlay-types'

/**
 * Kéo mép khung trên xem trước → hệ số đệm khung mới.
 *
 * Hàm thuần: nhận độ dời con trỏ trên MÀN HÌNH, trả hệ số đệm. Tách khỏi lớp
 * giao diện để kiểm được phần hình học — nhất là khi chữ đang xoay, chỗ mà "kéo
 * sang phải" không còn là kéo theo trục ngang của khối.
 */

export type TextFrameEdge = 'left' | 'right' | 'top' | 'bottom'

/** Mép trái/phải chỉnh đệm ngang, trên/dưới chỉnh đệm dọc. */
export function textFrameEdgeAxis(edge: TextFrameEdge): 'x' | 'y' {
  return edge === 'left' || edge === 'right' ? 'x' : 'y'
}

export function textFramePaddingScaleFromEdgeDrag(input: {
  edge: TextFrameEdge
  /** Hệ số đệm của trục đó lúc bắt đầu kéo. */
  startScale: number
  /** Độ dời con trỏ trên màn hình, px. */
  deltaXPx: number
  deltaYPx: number
  /** Góc xoay của khối chữ, độ. */
  rotationDeg: number
  /** Đệm MỘT bên ở hệ số 1, tính bằng px composition. */
  basePaddingPx: number
  /** Số px màn hình ứng với một px composition (khung xem trước thu nhỏ bao nhiêu). */
  screenPxPerCompositionPx: number
}): number {
  const radians = (input.rotationDeg * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  // Chiếu độ dời lên hai trục CỦA KHỐI đã xoay.
  const alongX = input.deltaXPx * cos + input.deltaYPx * sin
  const alongY = -input.deltaXPx * sin + input.deltaYPx * cos

  // Kéo mép ra xa tâm là nới rộng: phải/dưới theo chiều dương, trái/trên ngược lại.
  const outward =
    input.edge === 'right'
      ? alongX
      : input.edge === 'left'
        ? -alongX
        : input.edge === 'bottom'
          ? alongY
          : -alongY

  // Đệm mỗi bên tăng đúng bằng quãng mép dời: khối giãn đều hai phía quanh tâm,
  // nên mép đang kéo đi theo con trỏ.
  const base = input.basePaddingPx * input.screenPxPerCompositionPx
  if (base <= 0) return clampTextFramePaddingScale(input.startScale)
  return clampTextFramePaddingScale(input.startScale + outward / base)
}
