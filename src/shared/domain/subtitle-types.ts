import type { Micros } from './time-units'

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

export function subtitleCueDurationUs(cue: SubtitleCue): Micros {
  return cue.endUs - cue.startUs
}

/**
 * Ngắt dòng theo số ký tự, ưu tiên ngắt ở khoảng trắng.
 * Dùng chung cho preview và cho việc sinh file ASS/SRT.
 */
export function wrapSubtitleText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

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
