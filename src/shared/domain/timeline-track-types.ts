import type { ClipColorGrade } from './clip-color-grade'
import type { ClipEffect } from './clip-effect-types'
import type { ClipMotion } from './clip-motion-types'

/**
 * Look màu (LUT dựng sẵn) áp lên clip hình. Lưu ID của look trong danh mục, không
 * lưu công thức: sửa công thức về sau thì dự án cũ đi theo.
 */
export interface ClipLook {
  id: string
  /** 0..1 — trộn với hình gốc. */
  intensity: number
}
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

/**
 * `image` là lane chứa ẢNH TĨNH. Nó chứa clip như lane hình, nhưng tách riêng
 * để ảnh không lẫn vào giữa các cảnh quay, và để clip ảnh chỉ kéo được sang lane
 * ảnh khác. Lane ảnh nằm dưới trong danh sách thì vẽ ĐÈ lên lane hình — đó là
 * cách đặt logo hay ảnh sản phẩm lên trên cảnh quay.
 *
 * `text` là lane chứa chữ đè hình. Khác ba loại kia ở một điểm quan trọng: nó
 * KHÔNG chứa clip. Chữ overlay nằm ở cấp tài liệu (`document.textOverlays`) và
 * chỉ trỏ ngược về lane bằng `trackId` — vì một dòng chữ vẽ trên toàn khung hình
 * chứ không thuộc một lớp hình nào. Lane ở đây chỉ để xếp chỗ trên timeline.
 */
export type TrackKind = 'video' | 'audio' | 'subtitle' | 'text' | 'image'

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
  /** Lia vụt kèm mờ chuyển động — nhịp nhanh, hợp video ngắn. */
  | 'whip-left'
  | 'whip-right'
  /** Nhoè dần rồi rõ. */
  | 'blur'
  /** Nhiễu hình vài khung — dùng dè, một lần trong video là đủ. */
  | 'glitch'
  | 'spin'
  /** Loé trắng rồi tắt. */
  | 'flash'

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
  /** Chỉnh màu: sáng, tương phản, bão hoà, nhiệt độ, tối góc. */
  colorGrade?: ClipColorGrade
  /** Look màu dựng sẵn (tab LUT), áp SAU chỉnh màu. */
  look?: ClipLook
  /** Effect hình (tab Effects), áp SAU look, theo đúng thứ tự trong mảng. */
  effects?: ClipEffect[]
  /**
   * Hiệu ứng khi clip này xuất hiện.
   *
   * Chuyển cảnh "ăn" vào phần nguồn NẰM TRƯỚC `sourceInUs` — đúng khái niệm
   * handle của các trình dựng phim. Không đủ handle thì thời lượng bị kẹp lại
   * chứ không kéo clip đi chỗ khác.
   */
  transitionIn?: ClipTransition
  /**
   * Hiệu ứng RA, chạy ở mấy khung cuối của clip.
   *
   * Khác `transitionIn` ở một điểm cốt lõi: nó KHÔNG kéo clip bắt đầu sớm hơn và
   * không tiêu thụ phần nguồn nào, nên không bị kẹp theo `sourceInUs`. Chỉ là
   * chính clip mờ/trượt/thu lại ở đoạn cuối.
   */
  transitionOut?: ClipTransition
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

/**
 * Ba cỡ lane cho timeline.
 *
 * Có cỡ nhỏ vì khung timeline ở chiều cao mặc định chỉ vừa khoảng bốn lane 64px,
 * mà một dự án có hình, tiếng, phụ đề và vài lane chữ là đã vượt xa con số đó —
 * lúc nào cũng phải cuộn thì không nhìn được tổng thể.
 *
 * Ba nấc chứ không phải ô nhập số: cỡ lane là chuyện nhìn cho vừa mắt, không ai
 * cần lane cao đúng 57 pixel.
 */
export const TRACK_HEIGHT_PRESETS = [
  { id: 'small', px: 40 },
  { id: 'medium', px: DEFAULT_TRACK_HEIGHT },
  { id: 'large', px: 96 }
] as const

export type TrackHeightPreset = (typeof TRACK_HEIGHT_PRESETS)[number]['id']

/**
 * Cỡ gần nhất với chiều cao đang dùng.
 *
 * Cần vì chiều cao lưu trong dự án là một con số, và dự án cũ (hoặc dự án do
 * agent sửa) có thể mang giá trị không trùng nấc nào. Trả về nấc gần nhất để ô
 * chọn luôn hiện một giá trị, thay vì rỗng trơ ra.
 */
export function trackHeightPresetOf(px: number): TrackHeightPreset {
  let best: { id: TrackHeightPreset; px: number } = TRACK_HEIGHT_PRESETS[0]
  for (const preset of TRACK_HEIGHT_PRESETS) {
    if (Math.abs(preset.px - px) < Math.abs(best.px - px)) best = preset
  }
  return best.id
}

/** Chiều cao của lane ảo chứa chữ chưa thuộc lane nào, co theo cỡ đang chọn. */
export function looseLaneHeight(trackHeightPx: number): number {
  return Math.round(trackHeightPx * 0.7)
}

/**
 * Ảnh tĩnh mặc định dài bao lâu khi đặt lên timeline.
 *
 * Ảnh không có thời lượng riêng — `probe.durationUs` của nó là 0 — nên chỗ nào
 * đặt ảnh cũng phải tự chọn một con số. Để hằng số ở domain thay vì ở từng nơi
 * gọi: kéo-thả trên timeline và công cụ AI phải cho ra cùng một kết quả, nếu
 * không thì cùng một tấm ảnh dài ngắn khác nhau tuỳ đường vào.
 */
export const IMAGE_DEFAULT_DURATION_US = 5_000_000

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
