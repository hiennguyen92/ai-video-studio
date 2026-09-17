import type { TrackKind } from '../../../../shared/domain/timeline-track-types'

/**
 * Tab con của panel Thuộc tính khi chọn một clip, và tab nào có nghĩa với loại
 * track nào. Ẩn hẳn tab vô nghĩa (ảnh không có Audio, clip tiếng không có Video)
 * thay vì bày một tab trống.
 */
export type ClipInspectorTab = 'basic' | 'video' | 'audio' | 'animation'

export function clipInspectorTabs(trackKind: TrackKind): ClipInspectorTab[] {
  const visual = trackKind === 'video' || trackKind === 'image'
  const audible = trackKind === 'video' || trackKind === 'audio'
  const tabs: ClipInspectorTab[] = ['basic']
  if (visual) tabs.push('video')
  if (audible) tabs.push('audio')
  // Tốc độ cần trục thời gian nguồn (video, tiếng); chuyển cảnh và zoom cần hình.
  // Ảnh tĩnh vẫn có chuyển cảnh + zoom, clip tiếng vẫn có tốc độ.
  tabs.push('animation')
  return tabs
}
