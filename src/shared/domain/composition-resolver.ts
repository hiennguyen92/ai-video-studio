import type { Micros } from './time-units'
import type { ProjectDocument } from './project-document-types'
import type { Clip, ClipTransform, Track } from './timeline-track-types'
import { clipEndUs, DEFAULT_CLIP_TRANSFORM } from './timeline-track-types'
import type { SubtitleCue, SubtitleTrack } from './subtitle-types'

/**
 * Chuyển timeline thành thứ cần hiển thị/kết xuất tại một mốc thời gian.
 *
 * Preview VÀ export cùng gọi hàm này (DESCRIPTION §4 "Tận dụng cùng dữ liệu
 * composition cho preview và export"). Nếu mỗi bên tự tính lấy, hình xem trước
 * và file xuất ra sẽ lệch nhau theo kiểu rất khó truy.
 */

export interface ActiveVideoLayer {
  trackId: string
  /** Thứ tự xếp lớp: số lớn nằm trên. */
  layerIndex: number
  clip: Clip
  assetId: string
  /** Vị trí cần seek tới trong asset nguồn. */
  sourceTimeUs: Micros
  transform: ClipTransform
  opacity: number
}

export interface ActiveAudioLayer {
  trackId: string
  clip: Clip
  assetId: string
  sourceTimeUs: Micros
  /** Gain cuối cùng sau khi nhân track, clip, fade và mute/solo. */
  gain: number
}

export interface CompositionFrame {
  video: ActiveVideoLayer[]
  audio: ActiveAudioLayer[]
  subtitles: Array<{ track: SubtitleTrack; cue: SubtitleCue }>
}

function clipActiveAt(clip: Clip, us: Micros): boolean {
  return us >= clip.startUs && us < clipEndUs(clip)
}

/** Vị trí tương ứng trong asset nguồn, có tính tới tốc độ phát. */
export function sourceTimeAt(clip: Clip, us: Micros): Micros {
  return clip.sourceInUs + Math.round((us - clip.startUs) * clip.speed)
}

/**
 * Hệ số fade in/out tại một mốc. Fade tuyến tính theo biên độ.
 * Trả về 1 khi không có fade hoặc đang ở giữa clip.
 */
export function fadeGainAt(clip: Clip, us: Micros): number {
  let gain = 1

  if (clip.fadeInUs > 0) {
    const elapsed = us - clip.startUs
    if (elapsed < clip.fadeInUs) gain *= Math.max(0, elapsed / clip.fadeInUs)
  }

  if (clip.fadeOutUs > 0) {
    const remaining = clipEndUs(clip) - us
    if (remaining < clip.fadeOutUs) gain *= Math.max(0, remaining / clip.fadeOutUs)
  }

  return gain
}

/** Solo bật ở bất kỳ track audio nào sẽ làm im mọi track audio không solo. */
function audioTrackAudible(track: Track, anySolo: boolean): boolean {
  if (track.muted) return false
  if (anySolo && !track.solo) return false
  return true
}

export function resolveCompositionAt(document: ProjectDocument, us: Micros): CompositionFrame {
  const frame: CompositionFrame = { video: [], audio: [], subtitles: [] }
  const anySolo = document.tracks.some((track) => track.kind === 'audio' && track.solo)

  document.tracks.forEach((track, trackIndex) => {
    if (track.kind === 'video') {
      if (track.hidden) return
      for (const clip of track.clips) {
        if (!clipActiveAt(clip, us) || !clip.assetId) continue
        const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
        frame.video.push({
          trackId: track.id,
          layerIndex: trackIndex,
          clip,
          assetId: clip.assetId,
          sourceTimeUs: sourceTimeAt(clip, us),
          transform,
          // Fade của clip video áp vào độ mờ, để mờ dần cũng dùng chung một mô hình fade.
          opacity: transform.opacity * fadeGainAt(clip, us)
        })
      }
      return
    }

    if (track.kind === 'audio') {
      if (!audioTrackAudible(track, anySolo)) return
      for (const clip of track.clips) {
        if (!clipActiveAt(clip, us) || !clip.assetId) continue
        frame.audio.push({
          trackId: track.id,
          clip,
          assetId: clip.assetId,
          sourceTimeUs: sourceTimeAt(clip, us),
          gain: track.volume * clip.volume * fadeGainAt(clip, us)
        })
      }
      return
    }

    // Track phụ đề: lane chỉ tham chiếu tới một SubtitleTrack, nội dung nằm ở đó.
    if (track.kind === 'subtitle' && track.subtitleTrackId && !track.hidden) {
      const subtitleTrack = document.subtitleTracks.find(
        (item) => item.id === track.subtitleTrackId
      )
      if (!subtitleTrack) return
      for (const cue of subtitleTrack.cues) {
        if (us >= cue.startUs && us < cue.endUs) {
          frame.subtitles.push({ track: subtitleTrack, cue })
        }
      }
    }
  })

  // Lớp trên vẽ sau.
  frame.video.sort((a, b) => a.layerIndex - b.layerIndex)
  return frame
}

/**
 * Video clip nằm TRÊN CÙNG tại mốc này — cái người xem thực sự nhìn thấy khi các
 * lớp đều không trong suốt. Preview dùng nó để quyết định khung hình chính.
 */
export function topmostVideoLayer(frame: CompositionFrame): ActiveVideoLayer | undefined {
  return frame.video.at(-1)
}
