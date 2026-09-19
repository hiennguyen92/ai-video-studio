import { valueAtFrame } from './keyframe-interpolation'
import type { ResolvedKeyframeTracks } from './keyframe-types'

/**
 * Âm lượng của một clip TẠI một khung hình, đã nhân cả mức của lane.
 *
 * Kế hoạch dựng hình mang hai số RIÊNG chứ không mang sẵn tích. Trước đây nó
 * nhân sẵn, nhưng keyframe chỉ được thay phần của CLIP — với một tích thì không
 * có cách nào tách lại phần đó ra mà không chia, và lane có thể bằng 0.
 */
export function volumeAtFrame(
  clip: {
    volume: number
    trackVolume: number
    keyframes?: ResolvedKeyframeTracks
  },
  frame: number
): number {
  return valueAtFrame(clip.keyframes?.['volume'], frame, clip.volume) * clip.trackVolume
}
