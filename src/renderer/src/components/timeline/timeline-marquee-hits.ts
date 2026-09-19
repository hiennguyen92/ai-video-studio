import { clipEndUs, type Track } from '../../../../shared/domain/timeline-track-types'
import { usToPx } from './timeline-geometry'

/** Khung chọn, theo pixel tính từ góc trên-trái của cột lane. */
export interface MarqueeRect {
  left: number
  top: number
  right: number
  bottom: number
}

/** Vị trí dọc của từng lane trong cột lane. */
export interface LaneRow {
  track: Track
  top: number
  bottom: number
}

/** Khung từ hai góc bất kỳ — kéo ngược lên trái cũng ra khung đúng. */
export function marqueeFromPoints(
  from: { x: number; y: number },
  to: { x: number; y: number }
): MarqueeRect {
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    right: Math.max(from.x, to.x),
    bottom: Math.max(from.y, to.y)
  }
}

/**
 * Clip mà khung chạm vào — chạm một phần là đủ, như Premiere và Final Cut: bắt
 * phải bao trọn thì clip dài vắt ra ngoài màn hình không bao giờ chọn được.
 *
 * Bỏ qua lane khoá: khoá là để không đụng nhầm, và chọn là bước đầu của đụng.
 */
export function clipsInMarquee(
  rows: readonly LaneRow[],
  rect: MarqueeRect,
  pixelsPerSecond: number
): string[] {
  const hits: string[] = []
  for (const { track, top, bottom } of rows) {
    if (track.locked || bottom <= rect.top || top >= rect.bottom) continue
    for (const clip of track.clips) {
      const left = usToPx(clip.startUs, pixelsPerSecond)
      const right = usToPx(clipEndUs(clip), pixelsPerSecond)
      if (right > rect.left && left < rect.right) hits.push(clip.id)
    }
  }
  return hits
}
