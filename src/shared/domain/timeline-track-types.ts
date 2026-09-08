import type { ClipMotion } from './clip-motion-types'
import type { Micros } from './time-units'

/**
 * Track và clip của timeline.
 *
 * Bất biến do reducer bảo đảm (không phải do nơi gọi tự giữ):
 * - clip trong cùng một track không bao giờ chồng lấn
 * - clips luôn được sắp xếp tăng dần theo startUs
 * - startUs >= 0 và durationUs > 0
 * - với video/audio: sourceInUs + durationUs * speed <= thời lượng asset
 *   (ảnh là ngoại lệ — kéo dài bao lâu cũng được)
 */

export type TrackKind = 'video' | 'audio' | 'subtitle'

/**
 * Vai trò của track audio. Quyết định nhóm hiển thị mặc định và là đầu vào của
 * auto-ducking (giảm nhạc nền khi có lời nói — DESCRIPTION §3.C).
 */
export type TrackRole = 'dialogue' | 'voiceover' | 'music' | 'sfx'

export interface ClipTransform {
  /** Dịch chuyển tính theo tỉ lệ khung hình (-1..1), 0 là giữa. */
  x: number
  y: number
  scale: number
  rotationDeg: number
  opacity: number
}

export const DEFAULT_CLIP_TRANSFORM: ClipTransform = {
  x: 0,
  y: 0,
  scale: 1,
  rotationDeg: 0,
  opacity: 1
}

/**
 * Kiểu chuyển cảnh khi một clip xuất hiện.
 *
 * Tất cả đều là hiệu ứng vẽ trên CHÍNH clip đến, phủ dần lên clip đi phía dưới —
 * không có phép trộn hai luồng nào. Nhờ vậy chúng biểu diễn được bằng CSS thuần,
 * chạy y hệt ở preview lẫn lúc xuất, và không làm co thời lượng timeline như
 * toán tử `xfade` của ffmpeg.
 */
export type TransitionKind =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'wipe-left'
  | 'wipe-right'
  | 'zoom'

export interface ClipTransition {
  kind: TransitionKind
  /** Thời lượng chuyển cảnh. Bị kẹp lại khi clip không đủ phần nguồn phía trước. */
  durationUs: Micros
}

/** Chuyển cảnh dài mặc định — đủ thấy nhưng không làm chậm nhịp video ngắn. */
export const DEFAULT_TRANSITION_DURATION_US = 500_000

export interface Clip {
  id: string
  /** Không có với clip phụ đề (nội dung nằm trong SubtitleTrack). */
  assetId?: string
  /** Vị trí trên timeline. */
  startUs: Micros
  /** Thời lượng chiếm chỗ trên timeline. */
  durationUs: Micros
  /** Điểm bắt đầu trong asset nguồn. */
  sourceInUs: Micros
  /** 1.0 = tốc độ gốc. Số giây nguồn tiêu thụ = durationUs * speed. */
  speed: number
  /** Gain tuyến tính 0..2. */
  volume: number
  fadeInUs: Micros
  fadeOutUs: Micros
  transform?: ClipTransform
  /**
   * Chuyển động chạy suốt clip (đẩy chậm, lia, giật phóng, rung).
   *
   * Tách khỏi `transform` vì `transform` là một giá trị TĨNH cho cả clip, còn
   * cái này đổi theo từng khung hình.
   */
  motion?: ClipMotion
  /**
   * Hiệu ứng khi clip này xuất hiện.
   *
   * Chuyển cảnh "ăn" vào phần nguồn NẰM TRƯỚC `sourceInUs` — đúng khái niệm
   * handle của các trình dựng phim. Không đủ handle thì thời lượng bị kẹp lại
   * chứ không kéo clip đi chỗ khác.
   */
  transitionIn?: ClipTransition
  /** Clip video và audio tách từ cùng một file di chuyển cùng nhau. */
  linkGroupId?: string
  label?: string
}

export interface Track {
  id: string
  kind: TrackKind
  role?: TrackRole
  name: string
  /** Chỉ áp dụng cho track video. */
  hidden: boolean
  /** Chỉ áp dụng cho track audio. */
  muted: boolean
  /** Chỉ áp dụng cho track audio — solo tắt mọi track audio khác. */
  solo: boolean
  locked: boolean
  /** Gain tuyến tính 0..2 áp cho cả track. */
  volume: number
  /** Chiều cao lane trên UI, tính bằng pixel. */
  height: number
  /** Với track phụ đề: id của SubtitleTrack mà lane này hiển thị. */
  subtitleTrackId?: string
  clips: Clip[]
}

export const DEFAULT_TRACK_HEIGHT = 64

/** Kết thúc của clip trên timeline. */
export function clipEndUs(clip: Clip): Micros {
  return clip.startUs + clip.durationUs
}

/** Số microgiây của asset nguồn mà clip tiêu thụ. */
export function clipSourceSpanUs(clip: Clip): Micros {
  return Math.round(clip.durationUs * clip.speed)
}

export function clipSourceOutUs(clip: Clip): Micros {
  return clip.sourceInUs + clipSourceSpanUs(clip)
}

export function clipContainsUs(clip: Clip, us: Micros): boolean {
  return us >= clip.startUs && us < clipEndUs(clip)
}

export function clipsOverlap(a: Clip, b: Clip): boolean {
  return a.startUs < clipEndUs(b) && b.startUs < clipEndUs(a)
}

/** Thời điểm kết thúc muộn nhất trong track. */
export function trackEndUs(track: Track): Micros {
  return track.clips.reduce((max, clip) => Math.max(max, clipEndUs(clip)), 0)
}
