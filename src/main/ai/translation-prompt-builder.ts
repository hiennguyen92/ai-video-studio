import type { GlossaryEntry } from '../../shared/domain/transcript-types'

/**
 * Dựng prompt dịch theo lô, giữ liên kết theo id.
 *
 * Vì sao gửi kèm id thay vì chỉ gửi danh sách câu theo thứ tự: mô hình rất hay
 * gộp hai câu ngắn hoặc tách một câu dài, làm lệch toàn bộ phần còn lại. Có id
 * thì lệch bao nhiêu cũng phát hiện được và hỏi lại đúng đoạn thiếu.
 *
 * Lô nhỏ vừa phải: lô càng dài mô hình càng hay bỏ sót đoạn cuối, mà lô quá ngắn
 * lại mất ngữ cảnh giữa các câu liền nhau và tốn nhiều lượt gọi.
 */

export const DEFAULT_TRANSLATION_BATCH_SIZE = 20

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface TranslationPromptInput {
  sourceLanguage?: string
  targetLanguage: string
  glossary: GlossaryEntry[]
  segments: Array<{ id: string; text: string }>
}

/** Tên ngôn ngữ dễ đọc cho mô hình; mã BCP-47 trần cho kết quả kém ổn định hơn. */
const LANGUAGE_NAMES: Record<string, string> = {
  vi: 'Vietnamese',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  th: 'Thai'
}

export function languageName(code: string | undefined): string {
  if (!code) return 'the source language'
  return LANGUAGE_NAMES[code.toLowerCase().split('-')[0]] ?? code
}

export function buildTranslationMessages(input: TranslationPromptInput): ChatMessage[] {
  const target = languageName(input.targetLanguage)
  const source = languageName(input.sourceLanguage)

  const rules = [
    `Translate each segment from ${source} into ${target}.`,
    // Ràng buộc quan trọng nhất: một vào, một ra.
    'Return EXACTLY one object per input segment, with the same "id" value.',
    'Never merge, split, reorder, drop, or invent segments.',
    // Đây là lời thoại có mốc thời gian, không phải văn bản để biên tập lại.
    'These are spoken subtitle lines: keep each translation close in length to its source.',
    'Keep proper nouns, numbers and product names unchanged unless the glossary says otherwise.',
    'If a segment is empty or untranslatable, return its original text unchanged.',
    'Reply with JSON only, no explanation, no markdown fences.'
  ]

  if (input.glossary.length > 0) {
    rules.push('Apply the glossary exactly; it overrides your own preferred wording.')
  }

  const glossaryBlock =
    input.glossary.length > 0
      ? `\n\nGlossary (source => target):\n${input.glossary
          .map((entry) => `- "${entry.from}" => "${entry.to}"`)
          .join('\n')}`
      : ''

  const payload = JSON.stringify(
    { segments: input.segments.map((segment) => ({ id: segment.id, text: segment.text })) },
    null,
    0
  )

  return [
    {
      role: 'system',
      content: `You are a professional subtitle translator.\n${rules.map((rule) => `- ${rule}`).join('\n')}${glossaryBlock}`
    },
    {
      role: 'user',
      content: `Translate these segments into ${target}. Respond with {"segments":[{"id":"...","text":"..."}]} containing all ${input.segments.length} ids.\n\n${payload}`
    }
  ]
}

/** Chia danh sách segment thành các lô để gửi đi. */
export function chunkSegments<T>(segments: T[], size: number): T[][] {
  const limit = Math.max(1, size)
  const batches: T[][] = []
  for (let index = 0; index < segments.length; index += limit) {
    batches.push(segments.slice(index, index + limit))
  }
  return batches
}
