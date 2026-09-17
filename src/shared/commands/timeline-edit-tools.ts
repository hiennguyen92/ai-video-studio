import type { Micros } from '../domain/time-units'
import { clipEndUs, clipSourceSpanUs, type Clip } from '../domain/timeline-track-types'
import { sortClips, trimClipEdgeTo, type TrimLimits } from './timeline-mutations'

/**
 * Phép sửa của các chế độ công cụ trên timeline (ngoài chế độ chọn thường):
 * slip, ripple trim, rate stretch. Hàm thuần, reducer chỉ gọi lại.
 */

/** Khoảng tốc độ cho phép, khớp lệnh `clip/set-speed`. */
export const MIN_CLIP_SPEED = 0.25
export const MAX_CLIP_SPEED = 4

/**
 * SLIP: đổi đoạn nguồn mà clip phát, GIỮ NGUYÊN vị trí và độ dài trên timeline.
 * Điểm vào bị kẹp trong vật liệu nguồn; ảnh tĩnh (không có thời lượng nguồn) thì
 * không slip được — trả lại clip nguyên vẹn.
 */
export function slipClip(clip: Clip, toSourceInUs: Micros, assetDurationUs?: Micros): Clip {
  if (assetDurationUs === undefined) return clip
  const maxIn = Math.max(0, assetDurationUs - clipSourceSpanUs(clip))
  const sourceInUs = Math.min(maxIn, Math.max(0, Math.round(toSourceInUs)))
  return sourceInUs === clip.sourceInUs ? clip : { ...clip, sourceInUs }
}

/**
 * Điểm vào nguồn khi kéo slip một đoạn `deltaUs` trên timeline.
 *
 * Kéo SANG PHẢI thì nội dung trôi sang phải theo tay — tức clip phát đoạn nguồn
 * SỚM hơn (điểm vào giảm), như khi đẩy cuộn phim dưới một khung cửa sổ cố định.
 */
export function slipSourceInForDrag(clip: Clip, deltaUs: Micros): Micros {
  return clip.sourceInUs - Math.round(deltaUs * clip.speed)
}

/**
 * RIPPLE TRIM: cắt/kéo dài một mép, rồi dời mọi clip PHÍA SAU trên cùng track theo
 * đúng lượng độ dài vừa đổi — không để lại khoảng trống, không đè lên clip nào.
 *
 * Mép đầu cũng ripple: clip GIỮ chỗ bắt đầu, phần nguồn ở đầu bị cắt/thêm, và mọi
 * thứ phía sau dịch theo. Trả về mảng clip mới của track, hoặc `null` nếu không hợp lệ.
 */
export function rippleTrimTrackClips(
  clips: Clip[],
  clipId: string,
  edge: 'start' | 'end',
  toUs: Micros,
  limits: TrimLimits
): Clip[] | null {
  const clip = clips.find((item) => item.id === clipId)
  if (!clip) return null
  const trimmed = trimClipEdgeTo(clip, edge, toUs, limits)
  if (!trimmed) return null

  const deltaUs = trimmed.durationUs - clip.durationUs
  if (deltaUs === 0) return clips
  const oldEndUs = clipEndUs(clip)
  const edited: Clip = edge === 'start' ? { ...trimmed, startUs: clip.startUs } : trimmed

  const rest = clips
    .filter((item) => item.id !== clip.id)
    .map((item) => (item.startUs >= oldEndUs ? { ...item, startUs: item.startUs + deltaUs } : item))
  return sortClips([...rest, edited])
}

/**
 * RATE STRETCH: kéo một mép để đổi độ dài clip, GIỮ NGUYÊN đoạn nguồn — tốc độ tự đổi
 * cho vừa (dài ra thì chậm lại, ngắn đi thì nhanh lên). Mép còn lại đứng yên.
 *
 * Tốc độ bị kẹp trong [0,25×; 4×], nên kéo quá tay thì clip dừng ở độ dài giới hạn.
 * Trả `null` khi kết quả ngắn hơn `minDurationUs`.
 */
export function rateStretchClip(
  clip: Clip,
  edge: 'start' | 'end',
  toUs: Micros,
  minDurationUs: Micros
): Clip | null {
  const spanUs = clipSourceSpanUs(clip)
  const endUs = clipEndUs(clip)
  // Kéo mép đầu thì mép cuối đứng yên, nên độ dài tối đa là tới đầu timeline.
  const maxDurationUs = edge === 'start' ? endUs : Number.POSITIVE_INFINITY
  const requested = edge === 'end' ? toUs - clip.startUs : endUs - toUs
  const wanted = Math.min(maxDurationUs, Math.max(1, requested))

  // Làm tròn tốc độ TRƯỚC rồi mới tính độ dài từ nó: tính ngược lại thì độ dài × tốc
  // độ lưu xuống lệch khỏi đoạn nguồn cũ một chút, và clip có thể đòi quá cuối file.
  const speed =
    Math.round(Math.min(MAX_CLIP_SPEED, Math.max(MIN_CLIP_SPEED, spanUs / wanted)) * 10_000) /
    10_000
  let durationUs = Math.round(spanUs / speed)
  if (edge === 'start') durationUs = Math.min(durationUs, endUs)
  if (durationUs < minDurationUs) return null

  return {
    ...clip,
    speed,
    startUs: edge === 'end' ? clip.startUs : endUs - durationUs,
    durationUs,
    fadeInUs: Math.min(clip.fadeInUs, durationUs),
    fadeOutUs: Math.min(clip.fadeOutUs, durationUs)
  }
}
