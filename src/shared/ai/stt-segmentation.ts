import type { SttSegment, SttWord } from './ai-provider-contracts'

/**
 * Cách chia bản phiên âm thành đoạn.
 *
 * - `phrase`: cụm ngắn ~60 ký tự (whisper.cpp tự cắt) — vừa một hai dòng phụ đề.
 * - `sentence`: mỗi đoạn là một CÂU, cắt theo dấu kết câu.
 * - `word`: mỗi đoạn là một TỪ — cho phụ đề hiện từng chữ, hoặc để cắt ghép chính xác.
 */
export type SttSegmentationMode = 'phrase' | 'sentence' | 'word'

export const STT_SEGMENTATION_MODES: SttSegmentationMode[] = ['phrase', 'sentence', 'word']

/** Câu dài hơn chừng này thì tìm dấu phẩy để ngắt, kẻo một đoạn phụ đề kín màn hình. */
const LONG_SENTENCE_US = 12_000_000
/** Trần cứng: quá chừng này vẫn chưa gặp dấu câu thì ngắt luôn ở từ hiện tại. */
const MAX_SENTENCE_US = 20_000_000
/** Từ có mốc bắt đầu = kết thúc thì kéo dài tối thiểu chừng này để còn hiện được. */
const MIN_WORD_US = 40_000

/** Dấu kết câu, cho phép theo sau là ngoặc/nháy đóng. */
const SENTENCE_END = /[.!?…。！？]["'”’)\]»]*$/
const CLAUSE_END = /[,;:，；：]["'”’)\]»]*$/

function flattenWords(segments: SttSegment[]): Array<SttWord | SttSegment> {
  // Đoạn không có mốc từng từ (hiếm) thì giữ nguyên cả đoạn như một "từ" lớn.
  return segments.flatMap((segment) =>
    segment.words && segment.words.length > 0 ? segment.words : [segment]
  )
}

function buildSegment(items: Array<SttWord | SttSegment>): SttSegment {
  const words = items.flatMap((item) =>
    'words' in item && item.words
      ? item.words
      : [{ startUs: item.startUs, endUs: item.endUs, text: item.text }]
  )
  return {
    startUs: items[0].startUs,
    endUs: Math.max(...items.map((item) => item.endUs)),
    text: items
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' '),
    words
  }
}

/**
 * Gom lại thành từng CÂU theo mốc thời gian của từ.
 *
 * whisper.cpp chia đoạn theo cửa sổ giải mã chứ không theo câu, nên một đoạn của nó
 * có thể chứa đuôi câu trước và đầu câu sau. Gom từ theo dấu kết câu thì mỗi đoạn là
 * trọn một câu. Câu quá dài (không có dấu chấm) được ngắt ở dấu phẩy sau 12 giây,
 * và ngắt cứng ở 20 giây.
 */
export function segmentBySentence(segments: SttSegment[]): SttSegment[] {
  const result: SttSegment[] = []
  let current: Array<SttWord | SttSegment> = []

  for (const item of flattenWords(segments)) {
    current.push(item)
    const spanUs = item.endUs - current[0].startUs
    const text = item.text.trim()
    const endsSentence = SENTENCE_END.test(text)
    const longAtClause = spanUs >= LONG_SENTENCE_US && CLAUSE_END.test(text)
    if (endsSentence || longAtClause || spanUs >= MAX_SENTENCE_US) {
      result.push(buildSegment(current))
      current = []
    }
  }
  if (current.length > 0) result.push(buildSegment(current))
  return result
}

/**
 * Mỗi từ thành một đoạn, KHÔNG chồng lên nhau: mốc DTW đôi khi cho đuôi từ trước lấn
 * sang đầu từ sau, nên mốc cuối bị kẹp ở đầu từ kế tiếp. Từ có mốc đầu = cuối thì kéo
 * dài tối thiểu 40 ms (cũng không vượt từ sau) để còn hiện được.
 */
export function segmentByWord(segments: SttSegment[]): SttSegment[] {
  const words = segments.flatMap((segment) =>
    segment.words && segment.words.length > 0
      ? segment.words
      : [{ startUs: segment.startUs, endUs: segment.endUs, text: segment.text }]
  )
  return words.map((word, index) => {
    const nextStartUs = words[index + 1]?.startUs ?? Number.POSITIVE_INFINITY
    const limitUs = Math.max(word.startUs, nextStartUs)
    const endUs = Math.min(limitUs, Math.max(word.endUs, word.startUs + MIN_WORD_US))
    const clean = { startUs: word.startUs, endUs, text: word.text.trim() }
    return { ...clean, words: [clean] }
  })
}

export function applySttSegmentation(
  segments: SttSegment[],
  mode: SttSegmentationMode | undefined
): SttSegment[] {
  if (mode === 'sentence') return segmentBySentence(segments)
  if (mode === 'word') return segmentByWord(segments)
  return segments
}
