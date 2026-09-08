import type { ProjectDocument } from './project-document-types'
import { projectDurationUs } from './project-document-types'
import { DEFAULT_CLIP_TRANSFORM, clipEndUs, type ClipTransform } from './timeline-track-types'
import type { SubtitleStyle } from './subtitle-types'
import { frameOfMicros, type FrameRate } from './time-units'

/**
 * Đổi `ProjectDocument` (micro giây) sang kế hoạch render theo KHUNG HÌNH.
 *
 * Remotion đếm bằng khung hình, dự án đếm bằng micro giây nguyên. Chỗ quy đổi là
 * nơi lỗi thích trốn nhất — lệch một khung ở đây thì tiếng và hình lệch nhau cả
 * bản dựng mà không có thông báo nào. Vì vậy nó được tách thành một hàm THUẦN,
 * kiểm bằng con số cụ thể, thay vì rải rác trong component React.
 *
 * Component chỉ việc vẽ lại kế hoạch này. Cả preview lẫn xuất file đều đọc cùng
 * một kế hoạch, nên không thể lệch nhau (DESCRIPTION §4).
 */

export interface RenderPlanVideoClip {
  key: string
  assetId: string
  fromFrame: number
  durationInFrames: number
  /** Khung bắt đầu bên trong file nguồn. */
  sourceFromFrame: number
  playbackRate: number
  volume: number
  fadeInFrames: number
  fadeOutFrames: number
  /** Track càng dưới trong danh sách càng vẽ sau, tức là nằm trên. */
  layerIndex: number
  transform: ClipTransform
  muted: boolean
}

export interface RenderPlanAudioClip {
  key: string
  assetId: string
  fromFrame: number
  durationInFrames: number
  sourceFromFrame: number
  playbackRate: number
  volume: number
  fadeInFrames: number
  fadeOutFrames: number
}

export interface RenderPlanSubtitleCue {
  key: string
  fromFrame: number
  durationInFrames: number
  text: string
  textSecondary?: string
  style: SubtitleStyle
}

export interface RenderPlan {
  width: number
  height: number
  fps: FrameRate
  durationInFrames: number
  backgroundColor: string
  video: RenderPlanVideoClip[]
  audio: RenderPlanAudioClip[]
  subtitles: RenderPlanSubtitleCue[]
}

/** Track có phát ra tiếng không, xét cả solo lẫn mute (giống lớp preview hiện có). */
function audioTrackAudible(track: ProjectDocument['tracks'][number], anySolo: boolean): boolean {
  if (track.muted) return false
  return anySolo ? Boolean(track.solo) : true
}

export function buildRenderPlan(document: ProjectDocument): RenderPlan {
  const fps = document.settings.frameRate
  const anySolo = document.tracks.some((track) => track.kind === 'audio' && track.solo)

  const video: RenderPlanVideoClip[] = []
  const audio: RenderPlanAudioClip[] = []
  const subtitles: RenderPlanSubtitleCue[] = []

  document.tracks.forEach((track, layerIndex) => {
    if (track.kind === 'video') {
      if (track.hidden) return

      for (const clip of track.clips) {
        if (!clip.assetId) continue
        const fromFrame = frameOfMicros(clip.startUs, fps)
        const endFrame = frameOfMicros(clipEndUs(clip), fps)
        const durationInFrames = endFrame - fromFrame
        // Clip ngắn hơn một khung thì không vẽ được; bỏ qua thay vì tạo Sequence
        // dài 0 khung mà Remotion sẽ từ chối.
        if (durationInFrames <= 0) continue

        video.push({
          key: clip.id,
          assetId: clip.assetId,
          fromFrame,
          durationInFrames,
          sourceFromFrame: frameOfMicros(clip.sourceInUs, fps),
          playbackRate: clip.speed,
          volume: clip.volume * track.volume,
          fadeInFrames: frameOfMicros(clip.fadeInUs, fps),
          fadeOutFrames: frameOfMicros(clip.fadeOutUs, fps),
          layerIndex,
          transform: clip.transform ?? DEFAULT_CLIP_TRANSFORM,
          // Track hình bị tắt tiếng vẫn phải hiện hình, chỉ câm.
          muted: !audioTrackAudible(track, anySolo)
        })
      }
      return
    }

    if (track.kind === 'audio') {
      if (!audioTrackAudible(track, anySolo)) return

      for (const clip of track.clips) {
        if (!clip.assetId) continue
        const fromFrame = frameOfMicros(clip.startUs, fps)
        const durationInFrames = frameOfMicros(clipEndUs(clip), fps) - fromFrame
        if (durationInFrames <= 0) continue

        audio.push({
          key: clip.id,
          assetId: clip.assetId,
          fromFrame,
          durationInFrames,
          sourceFromFrame: frameOfMicros(clip.sourceInUs, fps),
          playbackRate: clip.speed,
          volume: clip.volume * track.volume,
          fadeInFrames: frameOfMicros(clip.fadeInUs, fps),
          fadeOutFrames: frameOfMicros(clip.fadeOutUs, fps)
        })
      }
      return
    }

    // Track phụ đề chỉ trỏ tới một SubtitleTrack; nội dung nằm ở đó.
    if (track.kind === 'subtitle' && track.subtitleTrackId && !track.hidden) {
      const subtitleTrack = document.subtitleTracks.find(
        (item) => item.id === track.subtitleTrackId
      )
      if (!subtitleTrack) return

      for (const cue of subtitleTrack.cues) {
        const fromFrame = frameOfMicros(cue.startUs, fps)
        const durationInFrames = frameOfMicros(cue.endUs, fps) - fromFrame
        if (durationInFrames <= 0) continue

        subtitles.push({
          key: cue.id,
          fromFrame,
          durationInFrames,
          text: cue.text,
          textSecondary: cue.textSecondary,
          style: subtitleTrack.style
        })
      }
    }
  })

  // Lớp dưới vẽ trước; giữ đúng thứ tự track như lớp preview hiện có.
  video.sort((left, right) => left.layerIndex - right.layerIndex)

  return {
    width: document.settings.width,
    height: document.settings.height,
    fps,
    // Ít nhất một khung: Remotion không nhận composition dài 0 khung.
    durationInFrames: Math.max(1, frameOfMicros(projectDurationUs(document), fps)),
    backgroundColor: document.settings.backgroundColor,
    video,
    audio,
    subtitles
  }
}
