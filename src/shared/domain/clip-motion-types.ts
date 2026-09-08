/**
 * Chuyển động BÊN TRONG một clip.
 *
 * Khác chuyển cảnh — thứ chỉ chạy ở chỗ nối giữa hai clip. Cái này chạy suốt độ
 * dài clip, và với footage quay tay gần như tĩnh (review sản phẩm, ảnh chụp) nó
 * là thứ nâng cảm giác "có hậu kỳ" rõ nhất: một cú đẩy chậm 4% cũng đủ làm khung
 * hình thôi bị coi là ảnh chết.
 *
 * Mọi thứ ở đây là hàm THUẦN theo khung hình, không giữ trạng thái. Nhờ vậy khung
 * thứ N luôn cho ra cùng một kết quả dù đang tua preview hay đang xuất file — nếu
 * không, preview và bản xuất sẽ lệch nhau mà không ai biết.
 */

export type ClipMotionKind =
  /** Đẩy vào chậm — mặc định nên dùng cho cảnh sản phẩm tĩnh. */
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'pan-up'
  | 'pan-down'
  /** Giật phóng vào ở đầu clip rồi giữ nguyên — nhấn mạnh ngay lúc cắt. */
  | 'punch-in'
  /** Rung nhẹ liên tục — dùng cho câu hook, đừng dùng cho cả video. */
  | 'shake'

export interface ClipMotion {
  kind: ClipMotionKind
  /**
   * Cường độ 0–1. 1 là mức mạnh nhất còn coi được; trên mức đó khung hình bị
   * phóng quá to và lộ rõ vỡ hình trên footage điện thoại.
   */
  intensity: number
}

export const DEFAULT_MOTION_INTENSITY = 0.5

/** Kết quả tính cho một khung hình. `x`/`y` tính theo phần trăm cạnh khung. */
export interface MotionTransform {
  scale: number
  xPercent: number
  yPercent: number
}

export const NEUTRAL_MOTION_TRANSFORM: MotionTransform = { scale: 1, xPercent: 0, yPercent: 0 }

/**
 * Mức phóng nền khi lia máy.
 *
 * Lia mà không phóng trước thì kéo lộ mép khung ra ngoài hình, thành viền đen
 * chạy dọc cạnh. Đây là lỗi kinh điển của hiệu ứng Ken Burns làm ẩu.
 */
const PAN_BASE_SCALE = 1.14

/** Biên độ lia tối đa, theo phần trăm cạnh khung, ở cường độ 1. */
const PAN_RANGE_PERCENT = 5

/** Biên độ phóng tối đa ở cường độ 1. */
const ZOOM_RANGE = 0.16

function clampIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) return DEFAULT_MOTION_INTENSITY
  return Math.min(1, Math.max(0, intensity))
}

/**
 * Tính biến đổi cho một khung hình cụ thể.
 *
 * `frame` đếm từ 0 ở đầu clip. `durationInFrames` phải > 0; clip ngắn hơn một
 * khung đã bị loại từ lúc dựng kế hoạch dựng hình.
 */
export function motionTransformAt(
  motion: ClipMotion | undefined,
  frame: number,
  durationInFrames: number
): MotionTransform {
  if (!motion || durationInFrames <= 0) return NEUTRAL_MOTION_TRANSFORM

  const strength = clampIntensity(motion.intensity)
  if (strength === 0) return NEUTRAL_MOTION_TRANSFORM

  // 0 ở đầu clip, 1 ở khung cuối. Kẹp lại vì khung có thể vượt ra ngoài khi
  // chuyển cảnh kéo clip bắt đầu sớm hơn.
  const progress = Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames - 1)))

  switch (motion.kind) {
    case 'zoom-in':
      return { scale: 1 + ZOOM_RANGE * strength * progress, xPercent: 0, yPercent: 0 }

    case 'zoom-out':
      return { scale: 1 + ZOOM_RANGE * strength * (1 - progress), xPercent: 0, yPercent: 0 }

    case 'pan-left':
      return {
        scale: PAN_BASE_SCALE,
        xPercent: PAN_RANGE_PERCENT * strength * (1 - 2 * progress),
        yPercent: 0
      }

    case 'pan-right':
      return {
        scale: PAN_BASE_SCALE,
        xPercent: -PAN_RANGE_PERCENT * strength * (1 - 2 * progress),
        yPercent: 0
      }

    case 'pan-up':
      return {
        scale: PAN_BASE_SCALE,
        xPercent: 0,
        yPercent: PAN_RANGE_PERCENT * strength * (1 - 2 * progress)
      }

    case 'pan-down':
      return {
        scale: PAN_BASE_SCALE,
        xPercent: 0,
        yPercent: -PAN_RANGE_PERCENT * strength * (1 - 2 * progress)
      }

    case 'punch-in': {
      // Giật xong trong 20% đầu rồi ĐỨNG YÊN. Kéo dài cả clip sẽ thành zoom-out
      // chậm, mất hẳn cảm giác nhấn.
      const punch = Math.min(1, progress / 0.2)
      // Chậm dần ở cuối cho đỡ khựng.
      const eased = 1 - (1 - punch) ** 3
      return { scale: 1 + ZOOM_RANGE * strength * (1 - eased), xPercent: 0, yPercent: 0 }
    }

    case 'shake': {
      // Hai tần số lệch nhau để quỹ đạo không lặp thành một đường thẳng.
      const amplitude = 1.2 * strength
      return {
        scale: 1.04,
        xPercent: Math.sin(frame * 1.7) * amplitude,
        yPercent: Math.cos(frame * 2.3) * amplitude
      }
    }
  }
}

/** Chuỗi CSS transform cho một khung hình. Rỗng khi không có chuyển động. */
export function motionTransformCss(transform: MotionTransform): string {
  if (transform.scale === 1 && transform.xPercent === 0 && transform.yPercent === 0) {
    return ''
  }

  return `translate(${transform.xPercent.toFixed(4)}%, ${transform.yPercent.toFixed(4)}%) scale(${transform.scale.toFixed(4)})`
}
