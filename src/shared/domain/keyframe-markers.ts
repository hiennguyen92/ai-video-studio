import type { KeyframeEasing, KeyframeTracks } from './keyframe-types'
import type { Micros } from './time-units'

/**
 * Gộp mọi đường keyframe của một chủ thể thành MỘT hàng mốc để vẽ trên timeline.
 *
 * Một hàng cho mỗi thuộc tính nghe có vẻ đúng hơn, nhưng transform thôi đã năm
 * thuộc tính, cộng thông số effect nữa thì không hàng lane nào cao đủ. Và phần
 * lớn thao tác thật — dời một mốc, xoá một mốc — người dùng muốn áp cho MỌI
 * thuộc tính tại mốc đó cùng lúc.
 *
 * Mỗi mốc mang theo danh sách đường dẫn của nó, nên chỗ gọi vẫn phát được đúng
 * số lệnh cần thiết, và chú giải nói rõ mốc này đang giữ mấy thuộc tính.
 */
export interface KeyframeMarker {
  atUs: Micros
  /** Đường dẫn của những thuộc tính có keyframe tại đúng mốc này. */
  paths: string[]
  /** Kiểu nội suy, khi mọi thuộc tính tại mốc dùng chung một kiểu. */
  easing: KeyframeEasing | 'mixed'
}

export function keyframeMarkers(tracks: KeyframeTracks | undefined): KeyframeMarker[] {
  if (!tracks) return []

  const byTime = new Map<Micros, { paths: string[]; easings: Set<KeyframeEasing> }>()
  for (const path of Object.keys(tracks)) {
    for (const frame of tracks[path]) {
      const entry = byTime.get(frame.atUs) ?? { paths: [], easings: new Set<KeyframeEasing>() }
      entry.paths.push(path)
      entry.easings.add(frame.e ?? 'linear')
      byTime.set(frame.atUs, entry)
    }
  }

  return [...byTime.entries()]
    .map(([atUs, entry]) => ({
      atUs,
      paths: entry.paths,
      easing: entry.easings.size === 1 ? [...entry.easings][0] : ('mixed' as const)
    }))
    .sort((left, right) => left.atUs - right.atUs)
}
