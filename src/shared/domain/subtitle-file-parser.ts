import type { Micros } from './time-units'

/**
 * Đọc file phụ đề có sẵn (SRT và WebVTT) thành các cue.
 *
 * App vốn chỉ GHI được phụ đề ra file, không đọc vào — có sẵn một bản `.srt`
 * làm bằng công cụ khác thì phải gõ lại từng câu, mà cũng không có nút thêm
 * câu nào. Đây là nửa còn thiếu của đường đi đó.
 *
 * Hai định dạng dùng chung một bộ đọc vì chúng khác nhau rất ít: WebVTT dùng
 * dấu chấm cho phần mili giây và có thêm dòng `WEBVTT` mở đầu cùng vài khối
 * ghi chú, còn SRT dùng dấu phẩy và đánh số thứ tự. Viết hai bộ đọc gần giống
 * nhau là mời chúng trôi khỏi nhau.
 *
 * Bộ đọc KHÔNG bỏ cả file khi gặp một khối hỏng: file phụ đề tải trên mạng về
 * thường có vài khối lỗi, và mất một câu tốt hơn nhiều so với mất cả bản dịch.
 * Số khối bỏ qua được trả về để chỗ gọi nói cho người dùng biết.
 */

export interface ParsedSubtitleCue {
  startUs: Micros
  endUs: Micros
  text: string
}

export interface ParsedSubtitleFile {
  cues: ParsedSubtitleCue[]
  /** Số khối phải bỏ vì không đọc được. */
  skipped: number
}

/** Dòng thời gian: `00:00:01,500 --> 00:00:03,000` (SRT) hoặc dấu chấm (VTT). */
const TIME_LINE =
  /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/

export function parseSubtitleFile(content: string): ParsedSubtitleFile {
  const cues: ParsedSubtitleCue[] = []
  let skipped = 0

  // Tách theo DÒNG TRỐNG. Chuẩn hoá xuống dòng trước: file làm trên Windows
  // mang `\r\n`, và `\r` sót lại sẽ dính vào cuối câu chữ rồi hiện ra trên hình.
  const blocks = content
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .split(/\n{2,}/)

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '')
    if (lines.length === 0) continue

    // Bỏ phần đầu của WebVTT và các khối ghi chú/kiểu dáng của nó — chúng không
    // phải cue, nên không tính là khối hỏng.
    const head = lines[0].trim()
    if (/^WEBVTT/.test(head) || /^(NOTE|STYLE|REGION)\b/.test(head)) continue

    const timeIndex = lines.findIndex((line) => TIME_LINE.test(line))
    if (timeIndex < 0) {
      skipped += 1
      continue
    }

    const match = TIME_LINE.exec(lines[timeIndex])
    const startUs = match ? parseTimestamp(match[1]) : null
    const endUs = match ? parseTimestamp(match[2]) : null
    const text = lines
      .slice(timeIndex + 1)
      .join('\n')
      .trim()

    // Cue không có chữ, hoặc mốc kết thúc không sau mốc bắt đầu, là cue không
    // vẽ ra gì — bỏ và đếm lại thay vì nhét một khoảng rỗng vào timeline.
    if (startUs === null || endUs === null || endUs <= startUs || text === '') {
      skipped += 1
      continue
    }

    cues.push({ startUs, endUs, text })
  }

  // Sắp theo thời gian: file sửa tay hay có cue đảo thứ tự, và phần vẽ lẫn phần
  // nung ASS đều tin vào thứ tự tăng dần.
  cues.sort((left, right) => left.startUs - right.startUs)
  return { cues, skipped }
}

/** `01:02:03,456` hoặc `02:03.456` → micro giây. */
function parseTimestamp(value: string): Micros | null {
  const parts = value.replace(',', '.').split(':')
  if (parts.length < 2 || parts.length > 3) return null

  const seconds = Number(parts[parts.length - 1])
  const minutes = Number(parts[parts.length - 2])
  const hours = parts.length === 3 ? Number(parts[0]) : 0
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || !Number.isFinite(hours)) return null

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1_000_000)
}
