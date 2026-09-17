import type { Clip } from './timeline-track-types'

/**
 * Nhãn "đang áp gì" hiện trên clip ở timeline: LUT, zoom, rồi các effect theo đúng
 * thứ tự chồng. Effect cùng loại gộp một nhãn kèm số lần (×2, ×3) — chồng hai lần
 * tối góc là chuyện có chủ ý, nhưng hai nhãn giống hệt nhau chỉ tốn chỗ trên clip.
 *
 * Chỉ trả khoá; tên hiển thị do giao diện tra theo ngôn ngữ đang dùng.
 *
 * `collapseEffects`: clip có từ HAI LOẠI effect trở lên thì gom cả chồng về một nhãn
 * "Effect ×N" (N = tổng số effect) — trên clip chỉ có chỗ cho vài nhãn, liệt kê từng
 * loại thì LUT và Zoom bị đẩy mất. Tooltip vẫn dùng bản liệt kê đầy đủ.
 */
export type ClipAppliedTag =
  | { category: 'lut'; key: string; count: 1 }
  | { category: 'zoom'; key: string; count: 1 }
  | { category: 'effect'; key: string; count: number }

/** Khoá của nhãn gom mọi effect. */
export const ALL_EFFECTS_TAG_KEY = '*'

export function clipAppliedTags(
  clip: Clip,
  options: { collapseEffects?: boolean } = {}
): ClipAppliedTag[] {
  const tags: ClipAppliedTag[] = []
  if (clip.look) tags.push({ category: 'lut', key: clip.look.id, count: 1 })
  if (clip.motion) tags.push({ category: 'zoom', key: clip.motion.kind, count: 1 })

  const effects: Array<{ category: 'effect'; key: string; count: number }> = []
  for (const effect of clip.effects ?? []) {
    const existing = effects.find((tag) => tag.key === effect.kind)
    if (existing) existing.count += 1
    else effects.push({ category: 'effect', key: effect.kind, count: 1 })
  }
  if (options.collapseEffects && effects.length > 1) {
    const total = effects.reduce((sum, tag) => sum + tag.count, 0)
    return [...tags, { category: 'effect', key: ALL_EFFECTS_TAG_KEY, count: total }]
  }
  return [...tags, ...effects]
}
