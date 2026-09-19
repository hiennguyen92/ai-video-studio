import type { EditorCommand } from './editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { clipEndUs } from '../domain/timeline-track-types'

/**
 * Ripple delete CLIP: xoá clip rồi kéo mọi clip phía sau TRÊN CÙNG TRACK lùi lên
 * lấp chỗ trống.
 *
 * Chỉ track của clip, không phải mọi track — cùng luật với ripple trim. Kéo luôn
 * các track khác lùi theo sẽ xoá mất nhạc, lồng tiếng nằm dưới clip đó mà người
 * dùng không hề chọn. Muốn cả video co lại thì đã có ripple xoá THEO KHOẢNG.
 *
 * Nhiều clip thì xử lý từ clip MUỘN NHẤT về trước: xoá clip sau không làm dời
 * clip trước, nên toạ độ của những lệnh còn lại vẫn đúng. Một nhóm hình + tiếng
 * cùng khoảng thì mỗi track co đúng một lượng như nhau, nên vẫn khớp.
 *
 * Dùng chung cho nút, phím tắt và agent. Trả `null` khi không có clip nào xoá được.
 */
export function planRippleDeleteClips(
  document: ProjectDocument,
  clipIds: readonly string[]
): EditorCommand[] | null {
  const targets = document.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clipIds.includes(clip.id))
      .map((clip) => ({ trackId: track.id, fromUs: clip.startUs, toUs: clipEndUs(clip) }))
  )
  if (targets.length === 0) return null

  return targets
    .sort((left, right) => right.fromUs - left.fromUs)
    .map((target) => ({
      type: 'timeline/ripple-delete',
      fromUs: target.fromUs,
      toUs: target.toUs,
      trackIds: [target.trackId]
    }))
}
