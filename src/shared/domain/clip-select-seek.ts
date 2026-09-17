import { clipEndUs, type Clip } from './timeline-track-types'
import type { Micros } from './time-units'

/**
 * Đầu phát nên tới đâu khi người dùng BẤM chọn một clip trên timeline.
 *
 * - Đầu phát đang nằm ngoài clip: tua tới đúng chỗ bấm trong clip, để preview hiện
 *   ngay clip vừa chọn thay vì một cảnh khác.
 * - Đầu phát đã nằm trong clip: GIỮ NGUYÊN (trả `null`). Thao tác quen tay là đặt đầu
 *   phát trước, chọn clip sau, rồi cắt — tua theo chỗ bấm sẽ xô mất điểm cắt đã đặt.
 *
 * Chỗ bấm bị kẹp trong clip và lùi ít nhất một khung khỏi mép phải: đứng đúng mép
 * phải là đã sang clip sau (clip là nửa khoảng [đầu, cuối)).
 */
export function clipSelectSeekUs(
  clip: Pick<Clip, 'startUs' | 'durationUs'>,
  clickUs: Micros,
  playheadUs: Micros,
  frameUs: Micros
): Micros | null {
  const endUs = clipEndUs(clip as Clip)
  if (playheadUs >= clip.startUs && playheadUs < endUs) return null
  const lastFrameUs = Math.max(clip.startUs, endUs - Math.max(1, frameUs))
  return Math.min(lastFrameUs, Math.max(clip.startUs, Math.round(clickUs)))
}
