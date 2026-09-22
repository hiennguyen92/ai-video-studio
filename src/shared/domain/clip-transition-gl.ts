import type { BasicTransitionKind, CinematicTransitionKind } from './timeline-track-types'

/**
 * Nhóm chuyển cảnh chạy trên WebGL, trộn THẬT hai luồng hình.
 *
 * Ba kiểu này khác hẳn hai nhóm kia ở chỗ: chúng lấy mẫu lại TOẠ ĐỘ của cả hai
 * luồng. Bẻ cong mặt giấy, cháy loang theo nhiễu, lấy mười sáu mẫu dọc một tia —
 * không phép CSS nào làm được, vì CSS chỉ dời, cắt và lọc cả mảng hình chứ không
 * quyết định được từng điểm ảnh đọc ở đâu.
 *
 * Đổi lại, chúng đắt hơn hẳn: mỗi chuyển cảnh đang chạy cần một context WebGL, hai
 * thẻ media ẩn để lấy khung hình, và một nhịp chờ trước khi bản xuất chụp được.
 * Nên chỉ những kiểu CSS chịu thua mới lên đây.
 */
export const GL_TRANSITION_KINDS = ['page-curl', 'organic-dissolve', 'radial-blur'] as const

export type GlTransitionKind = (typeof GL_TRANSITION_KINDS)[number]

const GL_KINDS: ReadonlySet<string> = new Set(GL_TRANSITION_KINDS)

export function isGlTransitionKind(kind: string): kind is GlTransitionKind {
  return GL_KINDS.has(kind)
}

/**
 * Kiểu CSS đứng thay khi WebGL không dùng được.
 *
 * Máy không có WebGL2, context bị mất, shader không biên dịch nổi — ba chuyện đều
 * có thật và đều xảy ra GIỮA lúc dựng. Không có bản lùi thì chỗ nối ấy thành cắt
 * thẳng, mà người dùng thì đã thấy tên chuyển cảnh trong Inspector.
 *
 * Bản lùi vẽ ngay trên chính hai clip, y như mọi chuyển cảnh CSS khác; lớp WebGL
 * nằm ĐÈ lên và chỉ hiện khi nó vẽ xong. Nên khi WebGL chạy được thì không ai thấy
 * bản lùi, còn khi không thì không ai thấy chỗ hổng.
 */
export const GL_CSS_FALLBACK: Record<
  GlTransitionKind,
  BasicTransitionKind | CinematicTransitionKind
> = {
  // Lật trang là một cú gạt có mép; gạt mềm là cú gạt gần nó nhất.
  'page-curl': 'soft-wipe-left',
  // Cháy loang là mờ chồng có mép phát sáng; chồng sáng giữ lại phần phát sáng.
  'organic-dissolve': 'luma-blend',
  // Nhoè hướng tâm vẫn là nhoè.
  'radial-blur': 'blur'
}
