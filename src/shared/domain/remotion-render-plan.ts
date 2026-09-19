import { cueWordStartsUs } from './subtitle-word-timing'
import { resolveClipEffects } from './clip-effect-render'
import type { ClipEffect } from './clip-effect-types'
import { findClipLook } from './clip-look-catalog'
import { clampIntensity } from './clip-look-svg'
import type { ProjectDocument } from './project-document-types'
import { projectDurationUs } from './project-document-types'
import {
  DEFAULT_CLIP_TRANSFORM,
  clipEndUs,
  type Clip,
  type ClipTransform,
  type TransitionKind
} from './timeline-track-types'
import { hasAnyKeyframe } from './keyframe-clip-edits'
import { resolveKeyframeTracks } from './keyframe-interpolation'
import type { ResolvedKeyframeTracks } from './keyframe-types'
import { isNeutralColorGrade, type ClipColorGrade } from './clip-color-grade'
import type { ClipMotion } from './clip-motion-types'
import type { ClipBackgroundFill } from './timeline-track-types'
import type { SubtitleStyle } from './subtitle-types'
import {
  clampTextFramePaddingScale,
  type TextAnimation,
  type TextExitAnimation,
  type TextOverlay
} from './text-overlay-types'
import { frameOfMicros, type FrameRate } from './time-units'
import {
  findTextFrameDecor,
  findTextFramePalette,
  findTextFrameStyle,
  type TextFrameDecor,
  type ImageTextFrameStyle,
  type TextFramePalette,
  type VectorTextFrameStyle
} from './text-frame-catalog'

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
  /**
   * Ảnh tĩnh hay cảnh quay.
   *
   * Lớp vẽ phải biết để dùng đúng thẻ: ảnh đưa cho `OffthreadVideo` thì không ra
   * gì cả — và không có lỗi nào, chỉ là một ô trống.
   */
  media: 'video' | 'image'
  /**
   * Kích thước gốc của ảnh, để lớp vẽ đặt thẻ đúng bằng phần ảnh CHIẾM chỗ.
   *
   * Chỉ có với ảnh: một tấm ảnh vẽ `object-fit: contain` thì thẻ to bằng cả
   * khung hình còn ảnh chỉ nằm giữa, và khung điều khiển đo theo thẻ sẽ bao trọn
   * khung hình thay vì bao tấm ảnh.
   */
  natural?: { width: number; height: number }
  fromFrame: number
  durationInFrames: number
  /** Khung bắt đầu bên trong file nguồn. */
  sourceFromFrame: number
  playbackRate: number
  /** Âm lượng của riêng clip; nhân với `trackVolume` mới ra mức thật. */
  volume: number
  /** Âm lượng của lane chứa clip. Tách riêng để keyframe chỉ thay phần của clip. */
  trackVolume: number
  fadeInFrames: number
  fadeOutFrames: number
  /** Track càng dưới trong danh sách càng vẽ sau, tức là nằm trên. */
  layerIndex: number
  transform: ClipTransform
  /**
   * Những thuộc tính đang chạy keyframe, ĐÃ quy về khung hình.
   *
   * Mốc khung ở đây đã cộng sẵn phần dôi ra của chuyển cảnh, nên lớp vẽ đưa
   * thẳng `useCurrentFrame()` vào mà không phải trừ bớt gì. Xem chỗ dựng bên
   * dưới để biết vì sao phải cộng.
   */
  keyframes?: ResolvedKeyframeTracks
  /**
   * Số khung mà `<Sequence>` bắt đầu SỚM hơn mép clip, để phủ lên clip trước.
   *
   * Nói cách khác: `useCurrentFrame()` bằng 0 ở đây, còn mép clip — cái người
   * dùng nhìn thấy trên timeline — nằm ở khung `leadInFrames`. Mọi thứ tính
   * theo "vị trí trong clip" đều phải trừ số này ra.
   *
   * Riêng `keyframes` ở trên thì KHÔNG cần trừ: mốc của chúng đã cộng sẵn.
   */
  leadInFrames: number
  /** Chuyển động trong clip; lớp vẽ tự tính theo khung hình hiện tại. */
  motion?: ClipMotion
  /** Nền mờ phía sau clip, phủ kín khung. */
  backgroundFill?: ClipBackgroundFill
  colorGrade?: ClipColorGrade
  /**
   * Look màu ĐÃ TRA danh mục, kèm cường độ đã kẹp. Id lạ (dự án từ bản app khác)
   * hạ về `undefined` ở đây: clip vẫn hiện, chỉ mất look.
   */
  look?: { id: string; intensity: number }
  /**
   * Chồng effect đã lọc kind lạ, kẹp cường độ và thông số. Lớp vẽ chỉ việc dựng
   * bộ lọc theo khung hình, không phải kiểm lại.
   */
  effects?: ClipEffect[]
  muted: boolean
  /**
   * Hiệu ứng xuất hiện, tính bằng khung.
   *
   * Số khung này ĐÃ được kẹp theo phần nguồn còn dùng được, nên lớp vẽ cứ tin
   * dùng thẳng, không phải kiểm lại.
   */
  transition?: { kind: TransitionKind; frames: number }
  /** Hiệu ứng ra, đã kẹp theo độ dài clip. */
  exitTransition?: { kind: TransitionKind; frames: number }
}

export interface RenderPlanAudioClip {
  key: string
  assetId: string
  fromFrame: number
  durationInFrames: number
  sourceFromFrame: number
  playbackRate: number
  /** Âm lượng của riêng clip; nhân với `trackVolume` mới ra mức thật. */
  volume: number
  /** Âm lượng của lane chứa clip. Tách riêng để keyframe chỉ thay phần của clip. */
  trackVolume: number
  fadeInFrames: number
  fadeOutFrames: number
  /**
   * Đường keyframe của clip tiếng. Không có chuyển cảnh trên lane tiếng nên mốc
   * khung ở đây đếm thẳng từ mép clip, không phải bù gì.
   */
  keyframes?: ResolvedKeyframeTracks
}

export interface RenderPlanSubtitleCue {
  key: string
  /** Lớp vẽ, lấy theo vị trí lane trên timeline. */
  layerIndex: number
  fromFrame: number
  durationInFrames: number
  text: string
  textSecondary?: string
  style: SubtitleStyle
  /**
   * Mốc bắt đầu sáng của từng chữ, tính từ đầu câu (µs). Chỉ có khi track bật tô
   * nổi bật từng chữ.
   */
  wordStartOffsetsUs?: number[]
}

export interface RenderPlanTextOverlay {
  key: string
  /** Lớp vẽ, lấy theo vị trí lane trên timeline. */
  layerIndex: number
  fromFrame: number
  durationInFrames: number
  text: string
  style: SubtitleStyle
  /**
   * Thuộc tính chữ đang chạy keyframe, đã quy về khung hình.
   *
   * KHÔNG có phần bù lead-in như clip: `<Sequence>` của khối chữ bắt đầu đúng
   * tại `fromFrame = frameOfMicros(startUs)`, không bị trừ đi đoạn chuyển cảnh
   * nào. Chép cách làm của clip sang đây là đẩy chữ chạy trễ mất nửa giây.
   */
  keyframes?: ResolvedKeyframeTracks
  animation: TextAnimation
  /** Đã kẹp theo độ dài chính overlay, lớp vẽ cứ dùng thẳng. */
  animationFrames: number
  exitAnimation: TextExitAnimation
  /** Số khung của hiệu ứng ra, cũng đã kẹp. */
  exitFrames: number
  glow: boolean
  /**
   * Khung nền ĐÃ TRA XONG, hoặc `null` nếu không có khung.
   *
   * Tra danh mục ở tầng kế hoạch chứ không tra lúc vẽ: một `styleId` lạ không
   * được phép làm chết bản xuất. Id lạ đến từ ba đường thật — project dựng bởi
   * bản app mới hơn, một id ta bỏ đi ở bản sau, hoặc agent MCP gõ sai tên. Hạ về
   * `null` thì chữ vẫn hiện, chỉ mất khung. Tra trong lúc vẽ mà ném lỗi thì hỏng
   * cả video.
   */
  frame: ResolvedTextFrame | null
}

/** Khung vector sau khi tra danh mục: lớp vẽ cứ dùng thẳng, không tra cứu, không quyết. */
/** Hệ số đệm đã kẹp, lớp vẽ nhân thẳng vào đệm mặc định. */
export interface ResolvedTextFramePadding {
  x: number
  y: number
}

export interface ResolvedVectorTextFrame {
  kind: 'vector'
  padding: ResolvedTextFramePadding
  style: VectorTextFrameStyle
  palette: TextFramePalette
  /** Thiếu trang trí không làm mất khung — chỉ mất mỗi điểm trang trí. */
  decor?: TextFrameDecor
}

/** Khung ảnh: màu nằm trong ảnh, nên không có bộ màu lẫn trang trí. */
export interface ResolvedImageTextFrame {
  kind: 'image'
  padding: ResolvedTextFramePadding
  style: ImageTextFrameStyle
}

export type ResolvedTextFrame = ResolvedVectorTextFrame | ResolvedImageTextFrame

export interface RenderPlan {
  width: number
  height: number
  fps: FrameRate
  durationInFrames: number
  backgroundColor: string
  video: RenderPlanVideoClip[]
  audio: RenderPlanAudioClip[]
  subtitles: RenderPlanSubtitleCue[]
  textOverlays: RenderPlanTextOverlay[]
}

/**
 * Số khung mà chuyển cảnh của một clip thật sự dùng được.
 *
 * Chuyển cảnh làm clip đến BẮT ĐẦU SỚM HƠN để phủ lên clip đi, nên nó tiêu thụ
 * phần nguồn nằm trước `sourceInUs`. Ba giới hạn, lấy cái nhỏ nhất:
 *
 *   1. phần nguồn còn phía trước (`sourceInUs`) — không đọc được trước đầu file
 *   2. vị trí trên timeline — không kéo lùi qua mốc 0
 *   3. độ dài của chính clip — chuyển cảnh dài hơn clip thì vô nghĩa
 *
 * Kẹp lại thay vì từ chối: người dùng đặt 1 giây trên một clip chỉ còn 0,3 giây
 * handle thì nên được 0,3 giây, không nên mất trắng hiệu ứng.
 */
export function resolveTransitionFrames(
  clip: Clip,
  fps: FrameRate,
  /**
   * Nguồn có vô hạn phần đệm phía trước không.
   *
   * Đúng với ẢNH TĨNH: một tấm ảnh không có "phần nguồn trước điểm vào", nó cứ
   * đứng yên nên lấy bao nhiêu khung phía trước cũng được. Không mở ngoại lệ này
   * thì mọi chuyển cảnh trên ảnh bị kẹp về 0 và lặng lẽ mất tác dụng.
   */
  unlimitedHandle = false
): number {
  if (!clip.transitionIn) return 0

  const wanted = frameOfMicros(clip.transitionIn.durationUs, fps)
  if (wanted <= 0) return 0

  // Nguồn tiêu thụ nhanh hơn khi clip chạy nhanh, nên quy đổi theo tốc độ phát.
  const handleFrames = unlimitedHandle
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(frameOfMicros(clip.sourceInUs, fps) / Math.max(clip.speed, 0.01))
  const startFrame = frameOfMicros(clip.startUs, fps)
  const clipFrames = frameOfMicros(clipEndUs(clip), fps) - startFrame

  return Math.max(0, Math.min(wanted, handleFrames, startFrame, clipFrames))
}

/**
 * Dự án có dùng thứ mà đường ffmpeg KHÔNG vẽ được không.
 *
 * Filter graph ffmpeg không biết tới chuyển cảnh (vào lẫn ra), chữ overlay, chuyển
 * động, chỉnh màu hay look màu. Xuất bằng nó
 * khi dự án có hai thứ đó sẽ cho ra file THIẾU hiệu ứng mà không báo gì — kiểu
 * hỏng tệ nhất, vì người dùng chỉ phát hiện khi đã đăng video lên.
 *
 * Dùng hàm này để chọn bộ dựng thay cho người dùng, và để cảnh báo nếu họ vẫn cố
 * chọn ffmpeg.
 */
export function requiresRemotionRenderer(document: ProjectDocument): boolean {
  if (document.textOverlays.length > 0) return true
  return document.tracks.some(
    (track) =>
      // Filter graph ffmpeg dựng cho track hình đọc file bằng trục thời gian của
      // video; một tấm ảnh tĩnh không có trục đó, nên lane ảnh phải đi Remotion.
      (track.kind === 'image' && track.clips.length > 0) ||
      track.clips.some(
        (clip) =>
          clip.transitionIn !== undefined ||
          clip.transitionOut !== undefined ||
          clip.motion !== undefined ||
          // Filter graph ffmpeg không dựng lớp nền mờ; lặng lẽ bỏ nó thì file ra
          // có hai dải đen mà preview thì không.
          clip.backgroundFill !== undefined ||
          clip.look !== undefined ||
          (clip.effects?.length ?? 0) > 0 ||
          // Filter graph ffmpeg đọc transform và âm lượng dạng HẰNG SỐ, nên một
          // clip có keyframe xuất bằng nó sẽ ra file đứng hình mà không báo gì.
          hasAnyKeyframe(clip) ||
          !isNeutralColorGrade(clip.colorGrade)
      )
  )
}

/**
 * Số khung của hiệu ứng RA.
 *
 * Chỉ kẹp theo độ dài clip, không kẹp theo phần nguồn: hiệu ứng ra không kéo clip
 * bắt đầu sớm hơn nên chẳng tiêu thụ nguồn nào cả. Kẹp thêm NỬA clip để hiệu ứng
 * vào và ra không chiếm trọn thời lượng — chiếm trọn thì clip không bao giờ đứng
 * yên ở trạng thái nhìn được.
 */
function resolveExitTransition(
  clip: Clip,
  fps: FrameRate,
  durationInFrames: number
): { kind: TransitionKind; frames: number } | undefined {
  if (!clip.transitionOut) return undefined
  const wanted = frameOfMicros(clip.transitionOut.durationUs, fps)
  const frames = Math.min(wanted, Math.floor(durationInFrames / 2))
  if (frames <= 0) return undefined
  return { kind: clip.transitionOut.kind, frames }
}

/** Kích thước gốc của một asset, nếu probe đọc được. */
function naturalSizeOf(
  document: ProjectDocument,
  assetId: string
): { width: number; height: number } | undefined {
  const probe = document.assets.find((item) => item.id === assetId)?.probe
  if (!probe?.width || !probe.height) return undefined
  return { width: probe.width, height: probe.height }
}

/** Track có phát ra tiếng không, xét cả solo lẫn mute (giống lớp preview hiện có). */
function audioTrackAudible(track: ProjectDocument['tracks'][number], anySolo: boolean): boolean {
  if (track.muted) return false
  return anySolo ? Boolean(track.solo) : true
}

/**
 * Tra khung của một overlay về dạng dùng được, hoặc `null`.
 *
 * Kiểu khung HOẶC bộ màu lạ đều hạ cả khung về `null`: một khung không có bộ màu
 * thì không tô được, và một bộ màu không có hình thì không có gì để tô lên. Riêng
 * trang trí lạ chỉ bỏ mỗi trang trí — khung vẫn còn nguyên giá trị.
 */
export function resolveTextFrame(overlay: TextOverlay): ResolvedTextFrame | null {
  if (!overlay.frame) return null

  const style = findTextFrameStyle(overlay.frame.styleId)
  if (!style) return null
  // Kẹp ở đây chứ không tin project: file sửa tay hay bản app khác có thể ghi số
  // âm, và đệm âm làm chữ đè lên nét viền.
  const padding = {
    x: clampTextFramePaddingScale(overlay.frame.paddingScaleX),
    y: clampTextFramePaddingScale(overlay.frame.paddingScaleY)
  }
  // Khung ảnh bỏ qua bộ màu và trang trí dù project có ghi: màu đã nằm trong ảnh.
  if (style.kind === 'image') return { kind: 'image', style, padding }

  const palette = overlay.frame.paletteId
    ? findTextFramePalette(overlay.frame.paletteId)
    : undefined
  if (!palette) return null

  const decor = overlay.frame.decorId ? findTextFrameDecor(overlay.frame.decorId) : undefined
  return decor
    ? { kind: 'vector', style, palette, padding, decor }
    : { kind: 'vector', style, palette, padding }
}

export function buildRenderPlan(document: ProjectDocument): RenderPlan {
  const fps = document.settings.frameRate
  const anySolo = document.tracks.some((track) => track.kind === 'audio' && track.solo)

  const video: RenderPlanVideoClip[] = []
  const audio: RenderPlanAudioClip[] = []
  const subtitles: RenderPlanSubtitleCue[] = []

  document.tracks.forEach((track, layerIndex) => {
    if (track.kind === 'video' || track.kind === 'image') {
      if (track.hidden) return
      const isImageTrack = track.kind === 'image'

      for (const clip of track.clips) {
        if (!clip.assetId) continue
        const startFrame = frameOfMicros(clip.startUs, fps)
        const endFrame = frameOfMicros(clipEndUs(clip), fps)
        // Clip ngắn hơn một khung thì không vẽ được; bỏ qua thay vì tạo Sequence
        // dài 0 khung mà Remotion sẽ từ chối.
        if (endFrame - startFrame <= 0) continue

        // Chuyển cảnh kéo clip bắt đầu sớm hơn để phủ lên clip phía trước, và
        // lùi điểm vào nguồn tương ứng để nội dung không bị nhảy.
        const transitionFrames = resolveTransitionFrames(clip, fps, isImageTrack)
        const fromFrame = startFrame - transitionFrames
        const durationInFrames = endFrame - fromFrame

        video.push({
          key: clip.id,
          assetId: clip.assetId,
          media: isImageTrack ? 'image' : 'video',
          natural: isImageTrack ? naturalSizeOf(document, clip.assetId) : undefined,
          fromFrame,
          durationInFrames,
          // Ảnh không có trục thời gian nguồn; đọc từ khung 0 là đủ.
          sourceFromFrame: isImageTrack
            ? 0
            : Math.max(
                0,
                frameOfMicros(clip.sourceInUs, fps) - Math.round(transitionFrames * clip.speed)
              ),
          transition:
            transitionFrames > 0 && clip.transitionIn
              ? { kind: clip.transitionIn.kind, frames: transitionFrames }
              : undefined,
          exitTransition: resolveExitTransition(clip, fps, durationInFrames),
          playbackRate: clip.speed,
          // Hai số RIÊNG, không nhân sẵn: keyframe chỉ thay phần của clip, mà
          // từ một tích thì không tách lại được nếu không chia — và lane có thể
          // bằng 0. Lớp vẽ nhân lại.
          volume: clip.volume,
          trackVolume: track.volume,
          fadeInFrames: frameOfMicros(clip.fadeInUs, fps),
          fadeOutFrames: frameOfMicros(clip.fadeOutUs, fps),
          layerIndex,
          transform: clip.transform ?? DEFAULT_CLIP_TRANSFORM,
          // Cộng `transitionFrames` vào mốc keyframe, và đây là chỗ DUY NHẤT
          // biết phải cộng.
          //
          // `<Sequence>` của clip này bắt đầu ở `fromFrame`, tức SỚM hơn mép clip
          // đúng bằng độ dài chuyển cảnh vào — clip phải xuất hiện trước để phủ
          // lên clip phía trước. Nhưng `useCurrentFrame()` đếm từ `fromFrame`,
          // còn mốc keyframe người dùng đặt thì đếm từ mép clip. Không cộng bù
          // thì mọi chuyển động chạy sớm đúng nửa giây ở cấu hình mặc định —
          // thấy rõ nhưng không tài nào đoán ra nguyên nhân.
          keyframes: resolveKeyframeTracks(clip.keyframes, fps, transitionFrames),
          leadInFrames: transitionFrames,
          motion: clip.motion,
          backgroundFill: clip.backgroundFill,
          colorGrade: clip.colorGrade,
          look:
            clip.look && findClipLook(clip.look.id)
              ? { id: clip.look.id, intensity: clampIntensity(clip.look.intensity) }
              : undefined,
          effects: resolveClipEffects(clip.effects),
          // Track hình bị tắt tiếng vẫn phải hiện hình, chỉ câm. Ảnh thì không
          // có tiếng để mà bật.
          muted: isImageTrack || !audioTrackAudible(track, anySolo)
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
          // Hai số RIÊNG, không nhân sẵn: keyframe chỉ thay phần của clip, mà
          // từ một tích thì không tách lại được nếu không chia — và lane có thể
          // bằng 0. Lớp vẽ nhân lại.
          volume: clip.volume,
          trackVolume: track.volume,
          fadeInFrames: frameOfMicros(clip.fadeInUs, fps),
          fadeOutFrames: frameOfMicros(clip.fadeOutUs, fps),
          keyframes: resolveKeyframeTracks(clip.keyframes, fps)
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
          layerIndex,
          fromFrame,
          durationInFrames,
          text: cue.text,
          textSecondary: cue.textSecondary,
          style: subtitleTrack.style,
          wordStartOffsetsUs: subtitleTrack.style.wordHighlight
            ? cueWordStartsUs(cue).map((startUs) => startUs - cue.startUs)
            : undefined
        })
      }
    }
  })

  // Lớp dưới vẽ trước; giữ đúng thứ tự track như lớp preview hiện có.
  video.sort((left, right) => left.layerIndex - right.layerIndex)

  // Thứ tự vẽ đi theo THỨ TỰ LANE trên timeline, chung một luật cho hình, ảnh,
  // phụ đề và chữ: lane trên cùng vẽ trước nên nằm dưới, lane dưới cùng vẽ sau
  // nên nằm trên. Người dùng xếp lane chính là để quyết định cái nào che cái nào.
  //
  // Dòng chữ chưa thuộc lane nào xếp trên cùng, giữ đúng chỗ mà lane ảo vẫn đứng
  // ở cuối timeline.
  const LOOSE_TEXT_LAYER = Number.MAX_SAFE_INTEGER
  const textLaneOrder = new Map<string, number>()
  document.tracks.forEach((track, index) => {
    if (track.kind === 'text') textLaneOrder.set(track.id, index)
  })
  const hiddenTextLanes = new Set(
    document.tracks
      .filter((track) => track.kind === 'text' && track.hidden)
      .map((track) => track.id)
  )

  const orderedOverlays = document.textOverlays
    .map((overlay, index) => ({ overlay, index }))
    .sort((left, right) => {
      const leftLane = textLaneOrder.get(left.overlay.trackId ?? '') ?? LOOSE_TEXT_LAYER
      const rightLane = textLaneOrder.get(right.overlay.trackId ?? '') ?? LOOSE_TEXT_LAYER
      // Cùng lane thì giữ nguyên thứ tự trong tài liệu — sort ổn định không được
      // đảm bảo với mọi công cụ, nên so luôn chỉ số gốc.
      return leftLane - rightLane || left.index - right.index
    })
    .map((entry) => entry.overlay)

  const textOverlays: RenderPlanTextOverlay[] = []
  for (const overlay of orderedOverlays) {
    // Ẩn lane thì chữ trên nó biến mất khỏi cả preview lẫn bản xuất, giống hệt
    // ẩn track hình.
    if (overlay.trackId && hiddenTextLanes.has(overlay.trackId)) continue

    const fromFrame = frameOfMicros(overlay.startUs, fps)
    const durationInFrames = frameOfMicros(overlay.endUs, fps) - fromFrame
    if (durationInFrames <= 0) continue

    textOverlays.push({
      key: overlay.id,
      layerIndex: textLaneOrder.get(overlay.trackId ?? '') ?? LOOSE_TEXT_LAYER,
      fromFrame,
      durationInFrames,
      text: overlay.text,
      // Lead-in 0: khối chữ không bắt đầu sớm hơn mốc của nó như clip.
      keyframes: resolveKeyframeTracks(overlay.keyframes, fps, 0),
      style: overlay.style,
      animation: overlay.animation,
      // Hiệu ứng vào dài hơn chính overlay là vô nghĩa; kẹp lại.
      animationFrames: Math.min(frameOfMicros(overlay.animationDurationUs, fps), durationInFrames),
      exitAnimation: overlay.exitAnimation ?? 'none',
      // Vào và ra cùng lấy từ một thời lượng, nhưng mỗi bên nhiều nhất NỬA overlay:
      // để cả hai chiếm trọn thì chữ không bao giờ đứng yên ở trạng thái đọc được.
      exitFrames:
        overlay.exitAnimation && overlay.exitAnimation !== 'none'
          ? Math.min(
              frameOfMicros(overlay.animationDurationUs, fps),
              Math.floor(durationInFrames / 2)
            )
          : 0,
      glow: overlay.glow ?? false,
      frame: resolveTextFrame(overlay)
    })
  }

  return {
    width: document.settings.width,
    height: document.settings.height,
    fps,
    // Ít nhất một khung: Remotion không nhận composition dài 0 khung.
    durationInFrames: Math.max(1, frameOfMicros(projectDurationUs(document), fps)),
    backgroundColor: document.settings.backgroundColor,
    video,
    audio,
    subtitles,
    textOverlays
  }
}
