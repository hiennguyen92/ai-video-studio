import type { MediaAsset } from '../domain/media-asset-types'

/**
 * Mức làm sạch giọng. Số là độ giảm nhiễu của `afftdn` (dB): nhẹ giữ trọn chất
 * giọng, mạnh dọn được quạt máy và tiếng xe nhưng bắt đầu nghe "như dưới nước".
 */
export const VOICE_CLEANUP_STRENGTHS = { light: 8, medium: 14, strong: 22 } as const
export type VoiceCleanupStrength = keyof typeof VOICE_CLEANUP_STRENGTHS

export interface VoiceCleanupRequest {
  projectId: string
  /** Asset GỐC — không bao giờ là bản đã làm sạch. */
  source: MediaAsset
  strength: VoiceCleanupStrength
  /** Asset đã có, để tái dùng bản làm sạch cũ (trùng nội dung) thay vì thêm bản thứ hai. */
  existing: MediaAsset[]
}
