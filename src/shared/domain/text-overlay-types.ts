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

/** Hiệu ứng ra. Không có "gõ chữ" vì gõ ngược lại không giống bất cứ thứ gì. */
export type TextExitAnimation = 'none' | 'fade' | 'shrink' | 'slide-down'

export interface TextOverlay {
  id: string
  text: string
  startUs: Micros
  endUs: Micros
  style: SubtitleStyle
  animation: TextAnimation
  /** Thời lượng hiệu ứng xuất hiện. Dài hơn chính overlay thì bị kẹp lúc dựng. */
  animationDurationUs: Micros
  /**
   * Hiệu ứng RA, chạy ở cuối overlay.
   *
   * Tách khỏi `animation` chứ không dùng lại nó theo chiều ngược: chữ hay vào
   * bằng một kiểu và ra bằng kiểu khác, và "gõ chữ" thì không có chiều ngược nào
   * hợp lý cả.
   */
  exitAnimation?: TextExitAnimation
  /**
   * Viền phát sáng quanh chữ.
   *
   * Chỉ áp cho chữ overlay, không áp cho phụ đề: bản nung phụ đề đi qua ASS, mà
   * ASS không có khái niệm phát sáng — bày ra ở đó sẽ là một ô không có tác dụng.
   */
  glow?: boolean
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

/**
 * Nền hộp sau chữ.
 *
 * Chỉ viền chữ là không đủ trên footage thật: chữ trắng viền đen đặt lên một nền
 * sáng và bận (màn hình, tường sáng, tờ giấy) vẫn khó đọc, và đó đúng là chỗ hook
 * với CTA hay rơi vào.
 */
export type TextOverlayBox = 'none' | 'dark' | 'light'

/**
 * Đặt nền hộp, kèm màu chữ và viền đi cùng.
 *
 * Ba thứ này phải đổi CÙNG nhau: hộp trắng mà giữ chữ trắng thì chữ biến mất, còn
 * giữ viền đen dày trên nền hộp thì chữ trông bẩn. Nên đây là một hàm chứ không
 * phải ba ô nhập rời để người dùng tự phối.
 */
export function applyTextOverlayBox(style: SubtitleStyle, box: TextOverlayBox): SubtitleStyle {
  if (box === 'dark') {
    return { ...style, boxColor: '#000000', boxOpacity: 0.6, color: '#FFFFFF', outlineWidthPx: 0 }
  }
  if (box === 'light') {
    return { ...style, boxColor: '#FFFFFF', boxOpacity: 0.9, color: '#111111', outlineWidthPx: 0 }
  }
  // Không hộp thì phải trả viền lại, nếu không chữ trắng nằm trần trên nền sáng.
  return { ...style, boxOpacity: 0, color: '#FFFFFF', outlineColor: '#000000', outlineWidthPx: 3 }
}

/** Đọc ngược kiểu hộp từ style, để ô chọn trên giao diện hiện đúng giá trị. */
export function readTextOverlayBox(style: SubtitleStyle): TextOverlayBox {
  if (style.boxOpacity <= 0) return 'none'
  return style.boxColor.toUpperCase() === '#FFFFFF' ? 'light' : 'dark'
}
