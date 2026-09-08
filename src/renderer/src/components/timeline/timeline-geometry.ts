import type { Micros, FrameRate } from '../../../../shared/domain/time-units'
import {
  microsToSeconds,
  secondsToMicros,
  snapMicrosToFrame
} from '../../../../shared/domain/time-units'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { clipEndUs } from '../../../../shared/domain/timeline-track-types'

/**
 * Quy đổi giữa thời gian và pixel trên timeline, cùng logic bắt dính.
 *
 * Tách riêng khỏi component vì đây là phần dễ sai nhất của timeline và cần
 * kiểm thử được mà không cần dựng DOM.
 */

export function usToPx(us: Micros, pixelsPerSecond: number): number {
  return microsToSeconds(us) * pixelsPerSecond
}

export function pxToUs(px: number, pixelsPerSecond: number): Micros {
  return secondsToMicros(px / pixelsPerSecond)
}

/** Bắt dính chỉ tính khi con trỏ nằm trong bán kính này (đơn vị pixel). */
export const SNAP_THRESHOLD_PX = 8

export interface SnapContext {
  document: ProjectDocument
  pixelsPerSecond: number
  frameRate: FrameRate
  playheadUs: Micros
  enabled: boolean
  /** Không bắt dính vào chính clip đang kéo. */
  excludeClipIds?: string[]
}

/**
 * Các mốc thời gian đáng bắt dính: điểm 0, playhead, và hai mép của mọi clip khác.
 * Mép clip là thứ người dùng thực sự muốn ghép khít vào.
 */
export function collectSnapTargets(context: SnapContext): Micros[] {
  const excluded = new Set(context.excludeClipIds ?? [])
  const targets: Micros[] = [0, context.playheadUs]

  for (const track of context.document.tracks) {
    for (const clip of track.clips) {
      if (excluded.has(clip.id)) continue
      targets.push(clip.startUs, clipEndUs(clip))
    }
  }

  return targets
}

export interface SnapResult {
  us: Micros
  /** Mốc đã bắt dính vào, nếu có — dùng để vẽ đường chỉ dẫn. */
  snappedTo: Micros | null
}

/**
 * Đưa một mốc thời gian về vị trí "đẹp".
 *
 * Thứ tự ưu tiên: mép clip / playhead trước, rồi mới tới lưới frame. Bám mép clip
 * quan trọng hơn bám frame vì đó là điều người dùng nhìn thấy và muốn.
 */
export function snapTime(us: Micros, targets: Micros[], context: SnapContext): SnapResult {
  const clamped = Math.max(0, us)

  if (!context.enabled) {
    return { us: clamped, snappedTo: null }
  }

  const thresholdUs = pxToUs(SNAP_THRESHOLD_PX, context.pixelsPerSecond)
  let best: Micros | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const target of targets) {
    const distance = Math.abs(target - clamped)
    if (distance <= thresholdUs && distance < bestDistance) {
      best = target
      bestDistance = distance
    }
  }

  if (best !== null) return { us: best, snappedTo: best }
  return { us: snapMicrosToFrame(clamped, context.frameRate), snappedTo: null }
}

/**
 * Khoảng chia của thước thời gian, chọn theo mức zoom.
 *
 * Nhảy theo các bước "tròn" quen thuộc (1/2/5/10/15/30 giây, rồi phút) để nhãn
 * trên thước luôn là con số dễ đọc thay vì 3.7 giây.
 */
const RULER_STEPS_SECONDS = [
  0.04, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600
]

export function rulerStepSeconds(pixelsPerSecond: number, minLabelSpacingPx = 72): number {
  for (const step of RULER_STEPS_SECONDS) {
    if (step * pixelsPerSecond >= minLabelSpacingPx) return step
  }
  return RULER_STEPS_SECONDS[RULER_STEPS_SECONDS.length - 1]
}

/** Mức zoom để toàn bộ timeline vừa khít bề rộng cho trước. */
export function zoomToFit(durationUs: Micros, widthPx: number): number {
  const seconds = microsToSeconds(durationUs)
  if (seconds <= 0 || widthPx <= 0) return 60
  // Chừa 8% khoảng thở ở cuối để clip cuối không dính sát mép.
  return (widthPx * 0.92) / seconds
}
