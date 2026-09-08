import type { Micros } from './time-units'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from './subtitle-types'

/**
 * Chữ đè lên hình: hook đầu video, giá, lời kêu gọi hành động.
 *
 * KHÁC phụ đề, dù nhìn qua đều là chữ trên hình:
 *
 *   - phụ đề sinh ra TỪ lời nói và bám theo mốc thời gian của transcript
 *   - chữ overlay do người dùng (hoặc AI) tự viết, tự đặt giờ, và thường có
 *     hiệu ứng xuất hiện riêng
 *
 * Gộp chúng làm một sẽ khiến "dựng lại phụ đề từ bản dịch" xoá mất cả dòng CTA
 * người dùng gõ tay.
 *
 * Kiểu chữ dùng LẠI `SubtitleStyle` thay vì định nghĩa mô hình song song: cùng
 * cần cỡ chữ, màu, viền, nền hộp, vị trí kiểu bàn phím số và lề.
 */

export type TextAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter'

export interface TextOverlay {
  id: string
  text: string
  startUs: Micros
  endUs: Micros
  style: SubtitleStyle
  animation: TextAnimation
  /** Thời lượng hiệu ứng xuất hiện. Dài hơn chính overlay thì bị kẹp lúc dựng. */
  animationDurationUs: Micros
}

/** Hiệu ứng vào mặc định — đủ nhanh để không làm chậm nhịp video ngắn. */
export const DEFAULT_TEXT_ANIMATION_DURATION_US = 350_000

/**
 * Kiểu mặc định cho chữ overlay.
 *
 * Khác mặc định của phụ đề ở hai chỗ có chủ ý: chữ TO hơn hẳn và nằm GIỮA khung
 * hình — hook và CTA phải đập vào mắt, còn phụ đề thì nằm dưới để không che hình.
 */
export function createDefaultTextOverlayStyle(): SubtitleStyle {
  return {
    ...DEFAULT_SUBTITLE_STYLE,
    fontSizePx: 84,
    alignment: 5,
    marginVerticalPx: 0,
    maxCharsPerLine: 22
  }
}
