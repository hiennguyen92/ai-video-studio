import type { AspectRatio } from './project-document-types'

/**
 * Chất lượng mã hoá.
 *
 * CRF cho bộ mã hoá phần mềm (thấp = đẹp hơn, file to hơn); bitrate cho bộ mã
 * hoá phần cứng vốn không nhận CRF. Bitrate tính cho 1080p rồi co giãn theo số
 * điểm ảnh: cùng một con số cho 4K và cho 540p thì một bản vỡ hình, một bản phí
 * dung lượng.
 */
export const EXPORT_QUALITIES = {
  high: { crf: 18, bitrateMbps1080p: 16 },
  standard: { crf: 21, bitrateMbps1080p: 10 },
  compact: { crf: 26, bitrateMbps1080p: 5 }
} as const
export type ExportQuality = keyof typeof EXPORT_QUALITIES

/** Bitrate (chuỗi ffmpeg, vd. "10M") cho một kích thước và mức chất lượng. */
export function hardwareBitrate(quality: ExportQuality, width: number, height: number): string {
  const pixels = (width * height) / (1920 * 1080)
  const mbps = Math.max(1, Math.round(EXPORT_QUALITIES[quality].bitrateMbps1080p * pixels))
  return `${mbps}M`
}

/**
 * Mẫu xuất cho nơi đăng.
 *
 * Mẫu KHÔNG đổi khung dự án: đổi khung lúc xuất là dời chỗ mọi chữ và clip mà
 * người dùng không hề thấy trên preview. Khung lệch thì hộp thoại nói ra, và
 * người dùng tự đổi khung ở nơi họ nhìn thấy kết quả.
 */
export interface ExportPreset {
  id: 'vertical-short' | 'youtube' | 'square'
  aspect: AspectRatio
  frameRate: '30'
  loudnessLufs: number
  quality: ExportQuality
}

export const EXPORT_PRESETS: ExportPreset[] = [
  // TikTok, Reels, Shorts cùng khung dọc 1080×1920 và cùng mức -14 LUFS.
  { id: 'vertical-short', aspect: '9:16', frameRate: '30', loudnessLufs: -14, quality: 'high' },
  { id: 'youtube', aspect: '16:9', frameRate: '30', loudnessLufs: -14, quality: 'high' },
  { id: 'square', aspect: '1:1', frameRate: '30', loudnessLufs: -14, quality: 'high' }
]

export function findExportPreset(id: string): ExportPreset | undefined {
  return EXPORT_PRESETS.find((preset) => preset.id === id)
}
