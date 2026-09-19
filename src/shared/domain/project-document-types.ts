import type { FrameRate, Micros } from './time-units'
import type { MediaAsset } from './media-asset-types'
import type { Track } from './timeline-track-types'
import type { DubbingSession, Transcript, Translation } from './transcript-types'
import type { SubtitleTrack } from './subtitle-types'
import type { TextOverlay } from './text-overlay-types'
import type { ProjectAiSettings } from './ai-settings-types'
import type { TimelineMarker } from './timeline-marker-types'

/**
 * Toàn bộ nội dung một project, lưu thành MỘT file JSON.
 *
 * `schemaVersion` là mốc để migrate khi cấu trúc thay đổi (DESCRIPTION §7).
 * Tăng số này mỗi khi đổi cấu trúc theo hướng không tương thích ngược, và
 * bổ sung hàm migrate tương ứng trong `project-document-migrations.ts`.
 */
export const CURRENT_PROJECT_SCHEMA_VERSION = 1

export type AspectRatio = '16:9' | '9:16' | '1:1'

export interface ProjectSettings {
  width: number
  height: number
  frameRate: FrameRate
  aspectRatio: AspectRatio
  sampleRate: number
  /** Màu nền khi khung hình không được clip nào che kín. */
  backgroundColor: string
}

export interface ProjectDocument {
  schemaVersion: number
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /**
   * Tăng đúng 1 sau mỗi command được commit.
   * Job AI chụp lại revision lúc bắt đầu; trước khi ghi kết quả sẽ so lại để
   * phát hiện project đã đổi trong lúc AI chạy (DESCRIPTION §5).
   */
  revision: number

  settings: ProjectSettings
  assets: MediaAsset[]
  tracks: Track[]
  transcripts: Transcript[]
  translations: Translation[]
  dubbingSessions: DubbingSession[]
  subtitleTracks: SubtitleTrack[]
  /** Chữ đè lên hình do người dùng tự viết — khác phụ đề sinh từ lời nói. */
  textOverlays: TextOverlay[]
  /** Mốc có tên trên timeline (chương, chỗ cần quay lại). */
  markers: TimelineMarker[]
  aiSettings: ProjectAiSettings
}

export const ASPECT_RATIO_DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 }
}

/** Thời điểm kết thúc muộn nhất trên toàn timeline. */
export function projectDurationUs(doc: ProjectDocument): Micros {
  let end = 0
  for (const track of doc.tracks) {
    for (const clip of track.clips) {
      const clipEnd = clip.startUs + clip.durationUs
      if (clipEnd > end) end = clipEnd
    }
  }
  for (const subtitleTrack of doc.subtitleTracks) {
    for (const cue of subtitleTrack.cues) {
      if (cue.endUs > end) end = cue.endUs
    }
  }
  // Chữ overlay cũng kéo dài video: một CTA đặt sau clip cuối mà không tính vào
  // đây sẽ bị cắt mất khi xuất.
  for (const overlay of doc.textOverlays) {
    if (overlay.endUs > end) end = overlay.endUs
  }
  return end
}

export function findTrack(doc: ProjectDocument, trackId: string): Track | undefined {
  return doc.tracks.find((track) => track.id === trackId)
}

export function findAsset(doc: ProjectDocument, assetId: string): MediaAsset | undefined {
  return doc.assets.find((asset) => asset.id === assetId)
}

/** Tìm clip theo id trên mọi track. */
export function findClip(
  doc: ProjectDocument,
  clipId: string
): { trackId: string; clipIndex: number } | undefined {
  for (const track of doc.tracks) {
    const clipIndex = track.clips.findIndex((clip) => clip.id === clipId)
    if (clipIndex >= 0) return { trackId: track.id, clipIndex }
  }
  return undefined
}

/** Asset đang được clip nào đó dùng — dùng để cảnh báo trước khi xoá. */
export function isAssetInUse(doc: ProjectDocument, assetId: string): boolean {
  return doc.tracks.some((track) => track.clips.some((clip) => clip.assetId === assetId))
}

/**
 * Đếm số clip đang dùng một media.
 *
 * Xoá media sẽ xoá luôn những clip đó, nên lời hỏi xác nhận phải nói RA con số.
 * "Media này đang được dùng, xoá không?" không đủ để người dùng biết mình sắp mất
 * bao nhiêu thứ trên timeline.
 */
export function countAssetUsages(doc: ProjectDocument, assetId: string): number {
  return doc.tracks.reduce(
    (total, track) => total + track.clips.filter((clip) => clip.assetId === assetId).length,
    0
  )
}
