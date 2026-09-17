import type { Micros } from './time-units'
import type { TextPosition } from './text-placement'

/**
 * Phụ đề là DỮ LIỆU chỉnh sửa được, không phải hình đã nung vào video
 * (DESCRIPTION §3.F). Một SubtitleTrack có thể xuất SRT, burn-in khi export,
 * hoặc hiển thị chồng lên preview.
 *
 * `SubtitleStyle` được mô tả bằng các khái niệm của ASS (alignment kiểu bàn phím số,
 * outline, margin) để preview CSS và burn-in bằng FFmpeg cùng đọc MỘT mô hình,
 * thay vì hai hệ style rời nhau lệch pha nhau (DESCRIPTION §4).
 */

/** Vị trí kiểu bàn phím số của ASS: 1=dưới-trái ... 5=giữa ... 9=trên-phải. */
export type SubtitleAlignment = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export interface SubtitleStyle {
  fontFamily: string
  /**
   * Tên PostScript của KIỂU cụ thể trong họ font, ví dụ `AmericanTypewriter-Bold`.
   *
   * Cần vì tên họ chỉ chọn được họ, không chọn được kiểu. Đo thật trong Chromium:
   * đặt `font-family` theo tên đầy đủ ("American Typewriter Bold") cho ra cùng bề
   * rộng với hai kiểu khác — tức là nó KHÔNG phân biệt được; đặt theo tên
   * PostScript thì bốn kiểu ra bốn bề rộng khác nhau.
   *
   * Bỏ trống nghĩa là dùng kiểu mặc định của họ.
   */
  fontPostScriptName?: string
  /** Đường dẫn file font. Bắt buộc khi burn-in để chắc chắn đủ dấu tiếng Việt. */
  fontFilePath?: string
  fontSizePx: number
  bold: boolean
  italic: boolean
  /** Màu dạng "#RRGGBB" — chuyển sang &HAABBGGRR của ASS ở lớp export. */
  color: string
  outlineColor: string
  outlineWidthPx: number
  shadowPx: number
  /** Nền hộp chữ. Đặt boxOpacity = 0 để tắt. */
  boxColor: string
  boxOpacity: number
  /**
   * Góc xoay chữ, tính bằng độ, chiều KIM ĐỒNG HỒ như CSS.
   *
   * ASS đếm ngược chiều kim đồng hồ nên lớp ghi ASS phải đảo dấu; để nguyên là
   * preview nghiêng một đằng, bản nung nghiêng một nẻo.
   */
  rotationDeg?: number
  /**
   * Tâm khối chữ, theo phần khung hình (0..1). Có thì BỎ QUA `alignment` và lề.
   *
   * Đặt được bằng cách kéo chữ ngay trên khung xem trước. Lúc nung, nó thành thẻ
   * `\an5\pos(x,y)` ở đầu dòng Dialogue — thẻ đó cũng ghi đè alignment, nên hai
   * bên bỏ qua cùng những thứ như nhau.
   */
  position?: TextPosition
  alignment: SubtitleAlignment
  marginLeftPx: number
  marginRightPx: number
  marginVerticalPx: number
  lineSpacingPx: number
  /** Số ký tự tối đa một dòng trước khi tự xuống dòng. */
  maxCharsPerLine: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  fontFamily: 'Be Vietnam Pro',
  fontSizePx: 48,
  bold: true,
  italic: false,
  color: '#FFFFFF',
  outlineColor: '#000000',
  outlineWidthPx: 3,
  shadowPx: 0,
  boxColor: '#000000',
  boxOpacity: 0,
  alignment: 2,
  marginLeftPx: 80,
  marginRightPx: 80,
  marginVerticalPx: 64,
  lineSpacingPx: 6,
  maxCharsPerLine: 42
}

export interface SubtitleCue {
  id: string
  startUs: Micros
  endUs: Micros
  text: string
  /** Dòng thứ hai khi bật phụ đề song ngữ (DESCRIPTION §3.F). */
  textSecondary?: string
  /** Segment transcript/bản dịch đã sinh ra cue này — giữ để truy vết ngược. */
  sourceSegmentId?: string
  edited: boolean
}

export interface SubtitleTrack {
  id: string
  name: string
  language: string
  /** Ngôn ngữ của dòng thứ hai khi hiển thị song ngữ. */
  secondaryLanguage?: string
  source: {
    kind: 'transcript' | 'translation' | 'manual' | 'imported'
    refId?: string
  }
  style: SubtitleStyle
  /** Style riêng cho dòng thứ hai; không có thì dùng chung `style` với cỡ nhỏ hơn. */
  secondaryStyle?: SubtitleStyle
  cues: SubtitleCue[]
}

/** Preset dễ đọc, hiển thị trong panel Phụ đề. */
export interface SubtitleStylePreset {
  id: string
  name: string
  style: Partial<SubtitleStyle>
}

export const SUBTITLE_STYLE_PRESETS: SubtitleStylePreset[] = [
  {
    id: 'classic-outline',
    name: 'Viền đen cổ điển',
    style: { color: '#FFFFFF', outlineColor: '#000000', outlineWidthPx: 3, boxOpacity: 0 }
  },
  {
    id: 'solid-box',
    name: 'Nền hộp đặc',
    style: { color: '#FFFFFF', outlineWidthPx: 0, boxColor: '#000000', boxOpacity: 0.75 }
  },
  {
    id: 'yellow-caption',
    name: 'Chữ vàng',
    style: { color: '#FFE45C', outlineColor: '#1A1A1A', outlineWidthPx: 3, boxOpacity: 0 }
  },
  {
    id: 'top-banner',
    name: 'Trên đỉnh màn hình',
    style: { alignment: 8, marginVerticalPx: 56, boxColor: '#000000', boxOpacity: 0.6 }
  }
]

/**
 * Trần độ dày viền chữ, dùng chung cho thanh trượt của phụ đề, chữ overlay và
 * công cụ MCP. 20px đủ cho viền kiểu sticker trên chữ 84–120px; dày hơn thì viền
 * nuốt mất lòng chữ.
 */
export const MAX_TEXT_OUTLINE_WIDTH_PX = 20

export function subtitleCueDurationUs(cue: SubtitleCue): Micros {
  return cue.endUs - cue.startUs
}

/**
 * Ngắt dòng theo số ký tự, ưu tiên ngắt ở khoảng trắng.
 * Dùng chung cho preview và cho việc sinh file ASS/SRT.
 *
 * Xuống dòng người dùng gõ (Enter) là ngắt CỨNG và luôn được giữ: mỗi đoạn tự
 * ngắt mềm theo số ký tự bên trong nó. Dòng trống cũng giữ, thành chuỗi rỗng —
 * nơi vẽ tự chèn khoảng trắng không ngắt để dòng đó còn chiều cao.
 */
export function wrapSubtitleText(text: string, maxCharsPerLine: number): string[] {
  if (text.trim() === '') return []
  return text.split(/\r?\n/).flatMap((paragraph) => wrapParagraph(paragraph, maxCharsPerLine))
}

/** Ngắt mềm một đoạn không có xuống dòng. Đoạn trống ra đúng một dòng trống. */
function wrapParagraph(paragraph: string, maxCharsPerLine: number): string[] {
  const words = paragraph.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']

  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines
}
