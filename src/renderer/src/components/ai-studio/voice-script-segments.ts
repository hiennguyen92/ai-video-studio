/**
 * Chia kịch bản thành các đoạn tạo lại được riêng lẻ (DESCRIPTION §3.B).
 *
 * Vì sao phải chia: mỗi nhà cung cấp có giới hạn ký tự cho một lần gọi, và quan
 * trọng hơn là khi một câu đọc sai thì người dùng chỉ muốn tạo lại đúng câu đó
 * chứ không phải cả bài.
 *
 * Thứ tự cắt: đoạn văn trước, rồi tới câu, cuối cùng mới cắt theo từ. Cắt giữa
 * câu làm ngữ điệu gãy, nên chỉ làm khi không còn cách nào khác.
 */

export interface ScriptSegment {
  id: string
  text: string
}

/**
 * Kết thúc câu trong tiếng Việt dùng đúng bộ dấu như tiếng Anh.
 * Dấu ba chấm được giữ nguyên khối để không tách thành ba câu rỗng.
 */
const SENTENCE_END = /([.!?…]+[)"'”』]*\s+)/

function splitLongTextByWords(text: string, limit: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > limit && current) {
      chunks.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function splitParagraphIntoSentences(paragraph: string, limit: number): string[] {
  if (paragraph.length <= limit) return [paragraph]

  // `split` giữ lại dấu câu vì mẫu có nhóm bắt, nên ghép lại thành câu trọn vẹn.
  const pieces = paragraph.split(SENTENCE_END)
  const sentences: string[] = []
  for (let index = 0; index < pieces.length; index += 2) {
    const sentence = (pieces[index] ?? '') + (pieces[index + 1] ?? '')
    if (sentence.trim()) sentences.push(sentence.trim())
  }

  const merged: string[] = []
  let current = ''
  for (const sentence of sentences) {
    // Câu đơn lẻ vẫn quá dài thì đành cắt theo từ.
    if (sentence.length > limit) {
      if (current) {
        merged.push(current)
        current = ''
      }
      merged.push(...splitLongTextByWords(sentence, limit))
      continue
    }

    const candidate = current ? `${current} ${sentence}` : sentence
    if (candidate.length > limit && current) {
      merged.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) merged.push(current)

  return merged.length > 0 ? merged : [paragraph]
}

let segmentCounter = 0
function nextSegmentId(): string {
  segmentCounter += 1
  return `seg_${Date.now().toString(36)}_${segmentCounter}`
}

export interface SplitOptions {
  /** Giới hạn ký tự của model; bỏ trống thì dùng mức an toàn. */
  maxCharacters?: number
}

/** Mức mặc định khi provider không công bố giới hạn — đủ ngắn để tạo lại nhanh. */
const DEFAULT_SEGMENT_LIMIT = 800

export function splitScriptIntoSegments(
  script: string,
  options: SplitOptions = {}
): ScriptSegment[] {
  const trimmed = script.trim()
  if (!trimmed) return []

  // Không dùng nguyên giới hạn của model làm độ dài đoạn: một đoạn 10.000 ký tự
  // đúng luật nhưng tạo lại rất lâu và khó soát. Lấy mức nhỏ hơn cho dễ làm việc.
  const limit = Math.min(options.maxCharacters ?? DEFAULT_SEGMENT_LIMIT, DEFAULT_SEGMENT_LIMIT)

  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim().replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)

  const segments: ScriptSegment[] = []
  for (const paragraph of paragraphs) {
    for (const piece of splitParagraphIntoSentences(paragraph, limit)) {
      segments.push({ id: nextSegmentId(), text: piece })
    }
  }

  return segments
}

/** Ghép các đoạn lại thành kịch bản, dùng khi người dùng muốn sửa toàn văn. */
export function joinSegments(segments: ScriptSegment[]): string {
  return segments.map((segment) => segment.text).join('\n\n')
}

export function createSegment(text: string): ScriptSegment {
  return { id: nextSegmentId(), text }
}
