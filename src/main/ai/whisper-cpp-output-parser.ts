import type { SttSegment, SttWord } from '../../shared/ai/ai-provider-contracts'

/**
 * Đọc file JSON của whisper.cpp.
 *
 * Tách khỏi phần chạy tiến trình con để kiểm thử được bằng dữ liệu thật mà không
 * cần model hàng trăm MB. Hình dạng dưới đây lấy từ output THẬT của whisper-cli
 * 1.9.2 chạy trên máy, không phải từ tài liệu.
 */

/** Hình dạng thật của file JSON do `-ojf` sinh ra. */
interface WhisperToken {
  text?: string
  /** Mốc thời gian tính bằng MILI GIÂY. */
  offsets?: { from?: number; to?: number }
  /** Xác suất của token, 0..1. */
  p?: number
}

interface WhisperSegment {
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: WhisperToken[]
}

interface WhisperOutput {
  result?: { language?: string }
  params?: { language?: string }
  transcription?: WhisperSegment[]
}

/**
 * Token đặc biệt của model, ví dụ `[_BEG_]` hay `[_TT_310]`.
 * Chúng không phải chữ người nói và phải bị loại trước khi ghép thành từ.
 */
function isSpecialToken(text: string): boolean {
  return /^\[_.*_?\]$/.test(text.trim())
}

/**
 * Ghép token thành TỪ.
 *
 * whisper.cpp trả về mảnh sub-word chứ không phải từ: "Xin chào" đến dưới dạng
 * `" Xin"`, `" ch"`, `"ào"`. Quy tắc ghép: token bắt đầu bằng dấu cách mở một từ
 * mới, token không có dấu cách đầu là phần nối tiếp của từ đang dở.
 *
 * Điều này đặc biệt quan trọng với tiếng Việt: dấu thanh thường nằm ở mảnh thứ
 * hai ("ch" + "ào"), nên nếu coi mỗi token là một từ thì timestamp sẽ rơi vào
 * giữa chữ và phụ đề theo từ sẽ vỡ.
 */
export function mergeTokensIntoWords(tokens: WhisperToken[]): SttWord[] {
  const words: SttWord[] = []

  for (const token of tokens) {
    const raw = token.text ?? ''
    if (!raw || isSpecialToken(raw)) continue

    const startsNewWord = raw.startsWith(' ')
    const text = raw.trim()
    if (!text) continue

    const fromUs = (token.offsets?.from ?? 0) * 1000
    const toUs = (token.offsets?.to ?? 0) * 1000

    const previous = words.at(-1)
    if (startsNewWord || !previous) {
      words.push({ startUs: fromUs, endUs: toUs, text })
    } else {
      // Nối vào từ đang dở và kéo dài mốc kết thúc.
      previous.text += text
      previous.endUs = Math.max(previous.endUs, toUs)
    }
  }

  return words
}

export interface ParsedTranscription {
  language: string
  segments: SttSegment[]
}

export function parseWhisperJson(raw: string): ParsedTranscription {
  let parsed: WhisperOutput
  try {
    parsed = JSON.parse(raw) as WhisperOutput
  } catch {
    throw new Error('whisper.cpp trả về JSON không đọc được.')
  }

  const transcription = parsed.transcription ?? []
  const segments: SttSegment[] = []

  for (const segment of transcription) {
    const text = (segment.text ?? '').trim()
    // Bỏ segment rỗng: whisper thỉnh thoảng sinh ra đoạn chỉ có khoảng lặng.
    if (!text) continue

    const words = segment.tokens ? mergeTokensIntoWords(segment.tokens) : undefined

    segments.push({
      startUs: (segment.offsets?.from ?? 0) * 1000,
      endUs: (segment.offsets?.to ?? 0) * 1000,
      text,
      words: words && words.length > 0 ? words : undefined
    })
  }

  return {
    // `result.language` là ngôn ngữ NHẬN DIỆN ĐƯỢC; `params.language` chỉ là
    // giá trị người dùng yêu cầu, và bằng "auto" khi để tự nhận diện.
    language: parsed.result?.language ?? parsed.params?.language ?? 'auto',
    segments
  }
}

/**
 * Rút phần trăm tiến trình từ stderr của whisper.cpp.
 *
 * Cờ `-pp` in ra dòng dạng `whisper_print_progress_callback: progress = 40%`.
 * Đây là con số THẬT do thư viện báo, nên job hiển thị được tiến trình đúng thay
 * vì thanh chạy vô định.
 */
export function parseProgressLine(line: string): number | null {
  const match = /progress\s*=\s*(\d+)%/.exec(line)
  if (!match) return null
  const percent = Number(match[1])
  if (!Number.isFinite(percent)) return null
  return Math.max(0, Math.min(1, percent / 100))
}
