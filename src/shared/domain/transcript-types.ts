import type { Micros } from './time-units'

/**
 * Transcript, bản dịch và lồng tiếng theo segment.
 *
 * Ba lớp dữ liệu này được giữ TÁCH RIÊNG khỏi clip, liên kết với nhau bằng id,
 * để chuỗi gốc -> bản dịch -> phụ đề -> lồng tiếng luôn truy vết được
 * (DESCRIPTION §3.E "Giữ liên kết giữa đoạn gốc, bản dịch và timestamp").
 */

export interface TranscriptWord {
  startUs: Micros
  endUs: Micros
  text: string
}

export interface TranscriptSegment {
  id: string
  startUs: Micros
  endUs: Micros
  text: string
  /** Chỉ có khi provider trả timestamp mức từ. */
  words?: TranscriptWord[]
  /** Nhãn người nói, chỉ có khi provider hỗ trợ phân biệt người nói. */
  speaker?: string
  /** Bật khi người dùng đã sửa tay — không ghi đè khi phiên âm lại. */
  edited: boolean
}

export interface Transcript {
  id: string
  /** Asset đã được phiên âm. */
  assetId: string
  /** Mã ngôn ngữ BCP-47, ví dụ "vi" hoặc "en". */
  language: string
  /** true khi ngôn ngữ do provider tự nhận diện. */
  languageAutoDetected: boolean
  providerId: string
  model: string
  createdAt: string
  segments: TranscriptSegment[]
}

export interface TranslationSegment {
  id: string
  /** Liên kết 1-1 tới TranscriptSegment gốc. */
  sourceSegmentId: string
  text: string
  edited: boolean
}

export interface GlossaryEntry {
  from: string
  to: string
}

export interface Translation {
  id: string
  transcriptId: string
  sourceLanguage: string
  targetLanguage: string
  providerId: string
  model: string
  createdAt: string
  /** Thuật ngữ riêng được giữ nguyên khi dịch (DESCRIPTION §3.E). */
  glossary: GlossaryEntry[]
  segments: TranslationSegment[]
}

/**
 * Cách xử lý khi audio lồng tiếng dài hơn khoảng thời gian của segment gốc.
 *
 * DESCRIPTION §3.E nói rõ: KHÔNG được tự cắt mất lời nói để ép khớp thời gian.
 * Người dùng phải chọn một trong ba hướng dưới đây.
 */
export type DubbingOverflowStrategy =
  /** Tăng tốc đọc trong giới hạn hợp lý (mặc định chặn ở 1.3x). */
  | 'speed-up'
  /** Người dùng rút ngắn nội dung rồi tạo lại. */
  | 'shorten-text'
  /** Giữ nguyên audio, đẩy dài khoảng thời gian trên timeline. */
  | 'extend-timeline'

export interface DubbingSegment {
  id: string
  /** Segment của bản dịch (hoặc transcript gốc) dùng để đọc. */
  sourceSegmentId: string
  /** Khoảng thời gian mục tiêu, lấy từ segment gốc. */
  targetStartUs: Micros
  targetEndUs: Micros
  /** Asset audio đã tạo. Chưa tạo thì chưa có. */
  assetId?: string
  /** Thời lượng ĐO ĐƯỢC của audio đã tạo, không phải ước lượng. */
  generatedDurationUs?: Micros
  /** Hệ số tăng tốc đã áp dụng, 1 nghĩa là chưa đổi. */
  appliedSpeed: number
  /** Cách xử lý mà người dùng đã chọn khi bị tràn. */
  overflowStrategy?: DubbingOverflowStrategy
  status: 'pending' | 'generating' | 'ready' | 'failed'
  error?: string
}

export interface DubbingSession {
  id: string
  /** Nguồn văn bản: bản dịch hoặc transcript gốc. */
  sourceKind: 'translation' | 'transcript'
  sourceId: string
  language: string
  providerId: string
  model: string
  voiceId: string
  /** Trần tăng tốc cho phép — vượt quá thì buộc chọn hướng khác. */
  maxSpeedUp: number
  createdAt: string
  segments: DubbingSegment[]
}

export const DEFAULT_MAX_DUBBING_SPEED_UP = 1.3

/** Audio tạo ra có vượt quá khoảng thời gian gốc không. */
export function isDubbingSegmentOverflowing(segment: DubbingSegment): boolean {
  if (segment.generatedDurationUs === undefined) return false
  const targetSpan = segment.targetEndUs - segment.targetStartUs
  return segment.generatedDurationUs > targetSpan
}

/** Hệ số tăng tốc cần thiết để audio vừa khít khoảng thời gian gốc. */
export function requiredSpeedUpForSegment(segment: DubbingSegment): number {
  if (segment.generatedDurationUs === undefined) return 1
  const targetSpan = segment.targetEndUs - segment.targetStartUs
  if (targetSpan <= 0) return 1
  return segment.generatedDurationUs / targetSpan
}
