import { longEdgeForShortEdge, shortEdgeOf } from './canvas-size'
import type { EditStyle } from './edit-style-catalog'
import type { AspectRatio, ProjectDocument } from './project-document-types'
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
      calls.push({ name: step.tool, arguments: projectArgs(style, step, document) })
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

/**
 * Tham số cho bước áp lên cả dự án.
 *
 * Bước đổi khung phải GIỮ độ phân giải đang có: kiểu dựng nói về HƯỚNG khung, nó
 * không có ý kiến gì về số điểm ảnh. Không nêu cạnh dài thì công cụ rơi về mặc
 * định 1920, và áp bất kỳ kiểu dựng nào lên dự án 4K là âm thầm hạ xuống 1080p —
 * đúng cái bẫy mà ô chọn tỉ lệ trên thanh preview đã phải tránh.
 */
function projectArgs(
  style: EditStyle,
  step: EditStyle['steps'][number],
  document: ProjectDocument
): Record<string, unknown> {
  if (step.tool !== 'set_canvas') return { ...step.args }
  return {
    ...step.args,
    longEdgePx: longEdgeForShortEdge(style.aspect, shortEdgeOf(document.settings))
  }
}

/**
 * Kiểu dựng sắp đổi khung sang hướng KHÁC với hướng dự án đang dùng.
 *
 * Khung dự án đã khớp hướng footage từ lúc nhập clip đầu tiên, nên đổi hướng ở
 * đây nghĩa là mọi clip đang có sẽ bị đóng hộp: clip dọc trong khung ngang thì hai
 * dải đen hai bên, và ngược lại. Kiểu dựng đổi khung mà không nói gì thì người
 * dùng chỉ phát hiện khi đã xuất xong video.
 *
 * Trả `null` khi không có gì để cảnh báo, trong đó có hai trường hợp KHÔNG phải
 * lỗi: timeline còn trống (chưa có gì để đóng hộp), và kiểu dựng tự lấp hai dải
 * trống bằng nền mờ — đó chính là việc mà "Ngang sang dọc" sinh ra để làm, cảnh
 * báo nó là báo nhầm.
 */
export function editStyleAspectMismatch(
  style: EditStyle,
  document: ProjectDocument
): { from: AspectRatio; to: AspectRatio } | null {
  const from = document.settings.aspectRatio
  if (style.aspect === from) return null
  if (fillsTheGaps(style)) return null

  const hasVisualClip = document.tracks.some(
    (track) => (track.kind === 'video' || track.kind === 'image') && track.clips.length > 0
  )
  return hasVisualClip ? { from, to: style.aspect } : null
}

/** Kiểu dựng có tự lấp hai dải trống bằng nền mờ không. */
function fillsTheGaps(style: EditStyle): boolean {
  return style.steps.some(
    (step) => step.tool === 'set_background_fill' && step.args.kind === 'blur'
  )
}
