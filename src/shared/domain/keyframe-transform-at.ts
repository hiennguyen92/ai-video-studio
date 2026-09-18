import { valueAtFrame } from './keyframe-interpolation'
import type { ResolvedKeyframeTracks } from './keyframe-types'
import type { ClipTransform } from './timeline-track-types'

/**
 * Chỗ đặt clip trong khung hình TẠI một khung cụ thể.
 *
 * Cùng vai trò với `motionTransformAt`: hàm thuần theo khung, không giữ trạng
 * thái, nên bản xem trước và bản xuất chạy đúng một phép tính trên đúng một con
 * số. Khác ở chỗ `motionTransformAt` sinh chuyển động từ một kiểu dựng sẵn, còn
 * hàm này đọc đường giá trị do chính người dùng đặt.
 *
 * `frame` đưa vào là `useCurrentFrame()` của clip, KHÔNG phải trừ bớt gì: phần
 * bù cho clip có chuyển cảnh đã được cộng sẵn vào mốc khung lúc dựng kế hoạch.
 */
export function transformValuesAt(
  keyframes: ResolvedKeyframeTracks | undefined,
  frame: number,
  staticTransform: ClipTransform
): ClipTransform {
  // Không có keyframe thì trả về CHÍNH object cũ, không dựng object mới: đây là
  // đường chạy của mọi clip trong mọi dự án chưa dùng tính năng này, và nó chạy
  // mỗi khung hình cho mỗi clip đang hiện.
  if (!keyframes) return staticTransform

  return {
    x: valueAtFrame(keyframes['transform.x'], frame, staticTransform.x),
    y: valueAtFrame(keyframes['transform.y'], frame, staticTransform.y),
    scale: valueAtFrame(keyframes['transform.scale'], frame, staticTransform.scale),
    rotationDeg: valueAtFrame(
      keyframes['transform.rotationDeg'],
      frame,
      staticTransform.rotationDeg
    ),
    opacity: valueAtFrame(keyframes['transform.opacity'], frame, staticTransform.opacity)
  }
}
