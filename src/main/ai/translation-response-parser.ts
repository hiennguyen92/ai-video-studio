import type { GlossaryEntry } from '../../shared/domain/transcript-types'
import { extractJsonBlock } from '../../shared/ai/model-json-extractor'

// Giữ lại tên cũ cho nơi đang dùng; phần hiện thực nằm ở shared vì AI Chat cũng cần.
export { extractJsonBlock }

/**
 * Đọc kết quả dịch do mô hình ngôn ngữ trả về và ÉP giữ liên kết 1-1 với segment gốc.
 *
 * Đây là chỗ nguy hiểm nhất của tính năng dịch. Mô hình ngôn ngữ rất hay:
 *   - bọc JSON trong khối ```json
 *   - nói vài câu dẫn nhập trước khi trả JSON
 *   - gộp hai câu ngắn thành một, hoặc tách một câu dài thành hai
 *   - đánh số lại id theo ý nó
 *   - bỏ sót đoạn cuối khi danh sách dài
 *
 * Nếu để những chuyện đó lọt qua, bản dịch sẽ lệch dần so với transcript và mọi
 * thứ dựng trên nó — phụ đề, lồng tiếng — đều sai giờ. Vì vậy module này KHÔNG
 * bao giờ đoán: id nào không khớp thì báo thiếu để lớp trên hỏi lại đúng những
 * đoạn đó, chứ không suy diễn theo thứ tự.
 */

export interface ParsedTranslationSegment {
  sourceSegmentId: string
  text: string
}

export interface ParsedTranslation {
  segments: ParsedTranslationSegment[]
  /** Id được yêu cầu nhưng không có trong kết quả — lớp trên phải hỏi lại. */
  missingIds: string[]
  /** Id lạ do mô hình bịa ra. Bị bỏ qua, nhưng vẫn báo để chẩn đoán. */
  unknownIds: string[]
  /** Id xuất hiện nhiều lần; chỉ lấy lần đầu. */
  duplicateIds: string[]
}

/** Lấy mảng segment ra khỏi JSON đã bóc, chấp nhận cả mảng trần lẫn object bọc ngoài. */
function readSegmentArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    // Các tên khoá thường gặp; máy chủ nào cũng đặt một kiểu.
    for (const key of ['segments', 'translations', 'result', 'data', 'items']) {
      const candidate = (value as Record<string, unknown>)[key]
      if (Array.isArray(candidate)) return candidate
    }
  }
  return []
}

export function parseTranslationResponse(raw: string, expectedIds: string[]): ParsedTranslation {
  const block = extractJsonBlock(raw)
  if (!block) {
    return { segments: [], missingIds: [...expectedIds], unknownIds: [], duplicateIds: [] }
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(block)
  } catch {
    return { segments: [], missingIds: [...expectedIds], unknownIds: [], duplicateIds: [] }
  }

  const expected = new Set(expectedIds)
  const seen = new Set<string>()
  const segments: ParsedTranslationSegment[] = []
  const unknownIds: string[] = []
  const duplicateIds: string[] = []

  for (const entry of readSegmentArray(decoded)) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>

    // Id có thể về dưới dạng số nếu mô hình "giúp" chuyển kiểu.
    const rawId = record.id ?? record.segmentId ?? record.sourceSegmentId
    const id = typeof rawId === 'string' ? rawId : typeof rawId === 'number' ? String(rawId) : ''
    const rawText = record.text ?? record.translation ?? record.translated
    if (!id || typeof rawText !== 'string') continue

    if (!expected.has(id)) {
      unknownIds.push(id)
      continue
    }
    if (seen.has(id)) {
      duplicateIds.push(id)
      continue
    }

    seen.add(id)
    segments.push({ sourceSegmentId: id, text: rawText.trim() })
  }

  return {
    segments,
    missingIds: expectedIds.filter((id) => !seen.has(id)),
    unknownIds,
    duplicateIds
  }
}

export interface GlossaryViolation {
  sourceSegmentId: string
  entry: GlossaryEntry
}

/**
 * Tìm những chỗ mô hình phớt lờ glossary.
 *
 * Nhắc trong prompt là chưa đủ — mô hình nhỏ bỏ qua khá thường xuyên. Ta không
 * tự thay chuỗi trong bản dịch vì làm vậy dễ sinh câu sai ngữ pháp; thay vào đó
 * chỉ ra đúng đoạn nào lệch để người dùng tự quyết.
 */
export function findGlossaryViolations(
  pairs: Array<{ sourceSegmentId: string; sourceText: string; translatedText: string }>,
  glossary: GlossaryEntry[]
): GlossaryViolation[] {
  const violations: GlossaryViolation[] = []

  for (const pair of pairs) {
    const source = pair.sourceText.toLowerCase()
    const translated = pair.translatedText.toLowerCase()

    for (const entry of glossary) {
      const from = entry.from.trim().toLowerCase()
      const to = entry.to.trim().toLowerCase()
      if (!from || !to) continue
      if (!source.includes(from)) continue
      if (!translated.includes(to))
        violations.push({ sourceSegmentId: pair.sourceSegmentId, entry })
    }
  }

  return violations
}
