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
/**
 * Nhóm có thành viên DÀI KHÁC NHAU (một bên đã bị cắt mép riêng) thì từ chối.
 *
 * Mỗi lane co đúng bằng độ dài clip của nó; hai độ dài khác nhau là hai lane co
 * hai lượng khác nhau, và mọi thứ phía sau lệch hình với tiếng mãi mãi — không
 * báo gì. Co cả hai lane theo khoảng hợp lại thì lại xoá mất phần của clip khác
 * nằm trong khoảng dôi ra. Không có cách tự động nào đúng, nên nói ra.
 */
export const UNEVEN_GROUP_ERROR =
  'Các clip trong nhóm dài khác nhau — ripple delete sẽ làm lệch hình và tiếng phía sau. Dùng Xoá thường, hoặc rã nhóm rồi xoá từng clip.'

export function planRippleDeleteClips(
  document: ProjectDocument,
  clipIds: readonly string[]
): { commands: EditorCommand[] } | { error: string } | null {
  const targets = document.tracks.flatMap((track) =>
    track.clips
      .filter((clip) => clipIds.includes(clip.id))
      .map((clip) => ({
        trackId: track.id,
        groupId: clip.linkGroupId,
        fromUs: clip.startUs,
        toUs: clipEndUs(clip)
      }))
  )
  if (targets.length === 0) return null

  const spanByGroup = new Map<string, string>()
  for (const target of targets) {
    if (!target.groupId) continue
    const span = `${target.fromUs}-${target.toUs}`
    const seen = spanByGroup.get(target.groupId)
    if (seen !== undefined && seen !== span) return { error: UNEVEN_GROUP_ERROR }
    spanByGroup.set(target.groupId, span)
  }

  return {
    commands: targets
      .sort((left, right) => right.fromUs - left.fromUs)
      .map((target) => ({
        type: 'timeline/ripple-delete' as const,
        fromUs: target.fromUs,
        toUs: target.toUs,
        trackIds: [target.trackId]
      }))
  }
}
