import type { EditStyle } from './edit-style-catalog'
import type { ProjectDocument } from './project-document-types'
import { findCutPoints, isJunction } from './timeline-cut-transitions'

/**
 * Giãn một kiểu dựng thành danh sách lời gọi công cụ cụ thể trên tài liệu này.
 *
 * Hàm thuần, và đó là chủ ý: nó là chỗ duy nhất biết "từng clip" nghĩa là những
 * clip nào, nên nó phải kiểm được bằng con số mà không cần dựng cả ứng dụng.
 *
 * Track ẩn bị bỏ qua — áp một look lên thứ người dùng không nhìn thấy là sửa dự
 * án sau lưng họ. Track khoá thì để bộ lập kế hoạch từ chối và báo ra, vì đó là
 * luật của nó chứ không phải của kiểu dựng.
 */
export function expandEditStyle(
  style: EditStyle,
  document: ProjectDocument
): Array<{ name: string; arguments: Record<string, unknown> }> {
  const visualTracks = document.tracks.filter(
    (track) => (track.kind === 'video' || track.kind === 'image') && !track.hidden
  )

  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  for (const step of style.steps) {
    if (step.target === 'project') {
      calls.push({ name: step.tool, arguments: { ...step.args } })
      continue
    }

    // Đếm XUYÊN track: vòng xoay là nhịp của cả video, không phải của từng lane.
    let index = 0
    /** `null` khi biến thể ở lượt này là "bỏ qua mục này". */
    const argsFor = (id: Record<string, string>): Record<string, unknown> | null => {
      const variant = step.cycle ? step.cycle[index % step.cycle.length] : {}
      index += 1
      return variant === null ? null : { ...step.args, ...variant, ...id }
    }

    for (const track of visualTracks) {
      if (step.target === 'each-visual-clip') {
        for (const clip of [...track.clips].sort((a, b) => a.startUs - b.startUs)) {
          const args = argsFor({ clipId: clip.id })
          if (args) calls.push({ name: step.tool, arguments: args })
        }
        continue
      }

      // Chỗ nối: công cụ nhận clip đứng TRƯỚC, không nhận mốc thời gian.
      for (const point of findCutPoints(track)) {
        if (!isJunction(point) || !point.leftClip) continue
        const args = argsFor({ fromClipId: point.leftClip.id })
        if (args) calls.push({ name: step.tool, arguments: args })
      }
    }
  }

  return calls
}
