import type { Micros } from './time-units'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyle } from './subtitle-types'
import type { TextFramePalette } from './text-frame-catalog'

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
  /**
   * Lane chữ trên timeline mà dòng này nằm trên.
   *
   * Không bắt buộc: dự án dựng trước khi có lane chữ không có trường này, và
   * chúng vẫn phải hiện ra. Thiếu hoặc trỏ vào lane đã xoá thì dòng chữ rơi về
   * lane ảo ở cuối timeline — vẫn thấy được, vẫn sửa được, không mất đi đâu.
   */
  trackId?: string
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
  /**
   * Khung nền dễ thương sau chữ.
   *
   * Cũng như `glow`, chỉ áp cho chữ overlay chứ không áp cho phụ đề: bản nung phụ
   * đề đi qua ASS, mà ASS chỉ vẽ được nền ĐẶC một màu (`BorderStyle 3`) — bày ra
   * ở đó sẽ là một ô không có tác dụng.
   */
  frame?: TextOverlayFrame
}

/**
 * Khung nền chữ, lưu bằng ID BỀN.
 *
 * Không lưu SVG và không lưu màu: hình vẽ với bảng màu là mã nguồn, sửa được và
 * dựng lại được. Chép chúng vào file project là đóng băng một bản cũ, và mọi lần
 * sửa nét vẽ về sau sẽ không với tới được dự án đã lưu.
 *
 * Trang trí LỒNG vào trong khung chứ không nằm cạnh nó, vì điểm trang trí đặt ở
 * GÓC KHUNG nên nó vô nghĩa khi không có khung. Lồng vào thì trạng thái "có trang
 * trí mà không có khung" không biểu diễn được. Và `frame === undefined` là đúng
 * một phép thử cho cả "dự án cũ" lẫn "không dùng khung".
 */
export interface TextOverlayFrame {
  styleId: string
  paletteId: string
  /** Điểm trang trí ở góc. Bỏ trống nghĩa là không có. */
  decorId?: string
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

/**
 * Đặt màu chữ theo bộ màu của khung, và TẮT nền hộp phẳng.
 *
 * Cùng lý do tồn tại với `applyTextOverlayBox` ngay trên: đổi khung thì màu chữ
 * phải đổi theo, chữ trắng nằm trên ruột khung màu kem là mất hút.
 *
 * `boxOpacity: 0` là phần bắt buộc, không phải dọn dẹp cho gọn: khung và nền hộp
 * cũ vẽ chồng lên nhau, và cái hộp xám chữ nhật thò ra sau khung bo góc là thứ
 * chỉ lộ ra khi đã xuất video.
 */
export function applyTextOverlayFrame(
  style: SubtitleStyle,
  palette: TextFramePalette
): SubtitleStyle {
  return { ...style, color: palette.text, outlineWidthPx: 0, boxOpacity: 0 }
}

/**
 * Lane chữ mà một dòng mới nên rơi vào.
 *
 * Lấy lane chữ CUỐI CÙNG trên timeline, vì đó gần như luôn là lane người dùng
 * vừa thêm — thêm lane rồi gõ chữ mà chữ rơi xuống lane ảo thì cái nút "Thêm
 * track text" chẳng để làm gì.
 *
 * Chưa có lane nào thì trả `undefined`, và dòng chữ về lane ảo như trước.
 */
export function defaultTextTrackId(
  tracks: Array<{ id: string; kind: string }>
): string | undefined {
  for (let index = tracks.length - 1; index >= 0; index--) {
    if (tracks[index].kind === 'text') return tracks[index].id
  }
  return undefined
}
