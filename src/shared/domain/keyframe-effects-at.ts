import { valueAtFrame } from './keyframe-interpolation'
import { parseEffectPath } from './keyframe-property-catalog'
import type { ClipEffect } from './clip-effect-types'
import type { ResolvedKeyframeTracks } from './keyframe-types'

/**
 * Chồng effect của clip TẠI một khung hình.
 *
 * Đánh giá ở lớp vẽ chứ không ở lúc dựng kế hoạch, vì nó phụ thuộc khung hình
 * còn kế hoạch thì không. Kế hoạch vẫn làm phần việc của nó — lọc `kind` lạ,
 * điền thông số thiếu — và hàm này chỉ thay những con số có keyframe.
 *
 * Không phải kẹp lại ở đây: giá trị đã kẹp theo khoảng của từng thông số ngay
 * lúc ghi, và nội suy giữa hai số trong khoảng bằng hàm đơn điệu thì không ra
 * ngoài được. Kẹp lại mỗi khung × mỗi effect là chi phí thuần tuý vô ích.
 */
export function effectsAtFrame(
  effects: readonly ClipEffect[] | undefined,
  keyframes: ResolvedKeyframeTracks | undefined,
  frame: number
): readonly ClipEffect[] | undefined {
  if (!effects?.length || !keyframes) return effects

  // Trả CHÍNH mảng cũ khi không thuộc tính effect nào chạy keyframe. Đây là
  // đường của mọi clip có effect trong mọi dự án hiện có, chạy mỗi khung hình:
  // dựng lại mảng ở đây là bắt chúng trả giá cho tính năng không dùng tới.
  let animated = false
  for (const path of Object.keys(keyframes)) {
    if (parseEffectPath(path)) {
      animated = true
      break
    }
  }
  if (!animated) return effects

  return effects.map((effect) => {
    const intensityTrack = keyframes[`effect.${effect.id}.intensity`]
    let params: Record<string, number | string> | undefined

    for (const key of Object.keys(effect.params)) {
      const track = keyframes[`effect.${effect.id}.params.${key}`]
      if (!track) continue
      // Chỉ sao chép thông số khi thật sự có cái đổi.
      params ??= { ...effect.params }
      params[key] = valueAtFrame(track, frame, Number(effect.params[key]))
    }

    if (!intensityTrack && !params) return effect
    return {
      ...effect,
      intensity: valueAtFrame(intensityTrack, frame, effect.intensity),
      params: params ?? effect.params
    }
  })
}
