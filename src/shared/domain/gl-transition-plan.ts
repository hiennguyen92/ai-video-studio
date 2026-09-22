import { isGlTransitionKind, type GlTransitionKind } from './clip-transition-gl'
import { CUT_JOIN_TOLERANCE_US } from './timeline-cut-transitions'
import { isNeutralColorGrade } from './clip-color-grade'
import { hasAnyKeyframe } from './keyframe-clip-edits'
import { DEFAULT_CLIP_TRANSFORM, clipEndUs, type Clip, type Track } from './timeline-track-types'
import { frameOfMicros, type FrameRate } from './time-units'

/**
 * Chỗ nối chạy bằng WebGL, mô tả đủ để lớp vẽ dựng lại hai luồng hình.
 *
 * Chuyển cảnh CSS vẽ trên CHÍNH từng clip, nên kế hoạch chỉ cần ghi kiểu và số
 * khung vào clip là xong. Chuyển cảnh WebGL thì khác: nó trộn hai luồng, nên nó là
 * một MỤC RIÊNG biết cả hai phía — lấy khung hình của clip đi và clip đến cùng
 * lúc, ở đúng điểm nguồn của mỗi bên.
 */
export interface RenderPlanGlTransition {
  key: string
  kind: GlTransitionKind
  /** Khung tuyệt đối nơi chuyển cảnh bắt đầu. */
  fromFrame: number
  durationInFrames: number
  layerIndex: number
  outgoing: GlTransitionSource
  incoming: GlTransitionSource
}

export interface GlTransitionSource {
  assetId: string
  media: 'video' | 'image'
  /** Khung nguồn ứng với khung đầu của chuyển cảnh. */
  sourceFromFrame: number
  playbackRate: number
}

/**
 * Clip có dựng lại được nguyên vẹn bằng một thẻ media trần không.
 *
 * Lớp WebGL lấy khung hình THẲNG từ file: nó không biết gì về chỉnh màu, look,
 * effect, phép biến đổi hay nền mờ — những thứ dự án này vẽ bằng bộ lọc SVG và CSS
 * ở tầng DOM. Cho một clip đã chỉnh màu đi qua đường WebGL thì giữa chuyển cảnh,
 * màu nó nhảy về gốc rồi nhảy lại.
 *
 * Nên chỗ nối nào có clip "đã trang điểm" thì để nguyên đường CSS. Bản lùi CSS vẫn
 * chạy đúng màu, chỉ không có cú lật trang.
 */
export function isPlainEnoughForGl(clip: Clip): boolean {
  return (
    // So với giá trị TRUNG TÍNH, không so với `undefined`: mọi clip chèn vào đều
    // mang sẵn một `transform` mặc định, nên hỏi "có transform không" thì câu trả
    // lời luôn là có, và đường WebGL không bao giờ chạy.
    isNeutralTransform(clip.transform) &&
    isNeutralColorGrade(clip.colorGrade) &&
    clip.motion === undefined &&
    clip.look === undefined &&
    clip.backgroundFill === undefined &&
    (clip.effects?.length ?? 0) === 0 &&
    !hasAnyKeyframe(clip)
  )
}

function isNeutralTransform(transform: Clip['transform']): boolean {
  if (!transform) return true
  return (
    transform.x === DEFAULT_CLIP_TRANSFORM.x &&
    transform.y === DEFAULT_CLIP_TRANSFORM.y &&
    transform.scale === DEFAULT_CLIP_TRANSFORM.scale &&
    transform.rotationDeg === DEFAULT_CLIP_TRANSFORM.rotationDeg &&
    transform.opacity === DEFAULT_CLIP_TRANSFORM.opacity
  )
}

/** Số khung của hai mép, đã kẹp chung — lấy từ `trackTransitionFrames`. */
export interface JunctionFrames {
  enter: ReadonlyMap<string, number>
  exit: ReadonlyMap<string, number>
}

/**
 * Mọi chỗ nối WebGL trên một track.
 *
 * Chỉ nhận chỗ nối mà CẢ HAI clip đều có asset và số khung chung lớn hơn 0. Chỗ
 * nối bị kẹp về 0 thì không có chuyển cảnh nào cả — dựng một lớp WebGL cho nó là
 * tốn một context để vẽ đúng không khung hình nào.
 */
export function glTransitionsOfTrack(
  track: Track,
  frames: JunctionFrames,
  fps: FrameRate,
  layerIndex: number
): RenderPlanGlTransition[] {
  const media = track.kind === 'image' ? 'image' : 'video'
  const clips = [...track.clips].sort((left, right) => left.startUs - right.startUs)
  const found: RenderPlanGlTransition[] = []

  for (let index = 0; index + 1 < clips.length; index++) {
    const left = clips[index]
    const right = clips[index + 1]
    if (!left.assetId || !right.assetId) continue
    if (Math.abs(right.startUs - clipEndUs(left)) > CUT_JOIN_TOLERANCE_US) continue

    const kind = right.transitionIn?.kind ?? left.transitionOut?.kind
    if (!kind || !isGlTransitionKind(kind)) continue
    if (!isPlainEnoughForGl(left) || !isPlainEnoughForGl(right)) continue

    const durationInFrames = Math.min(
      frames.enter.get(right.id) ?? 0,
      frames.exit.get(left.id) ?? 0
    )
    if (durationInFrames <= 0) continue

    const cutFrame = frameOfMicros(right.startUs, fps)
    const fromFrame = cutFrame - durationInFrames
    found.push({
      key: `${left.id}__${right.id}`,
      kind,
      fromFrame,
      durationInFrames,
      layerIndex,
      outgoing: sourceAt(left, media, fromFrame, fps),
      // Clip đến lùi điểm vào nguồn đúng bằng độ dài chuyển cảnh — nó phải phát
      // phần nguồn nằm TRƯỚC điểm vào của mình, đúng như lớp vẽ CSS vẫn làm.
      incoming: sourceAt(right, media, cutFrame, fps, durationInFrames)
    })
  }

  return found
}

/**
 * Điểm nguồn của một clip tại một khung tuyệt đối.
 *
 * `leadInFrames` là phần lùi thêm về trước điểm vào, chỉ clip đến mới có.
 * Ảnh tĩnh không có trục thời gian nguồn nên luôn đọc từ khung 0.
 */
function sourceAt(
  clip: Clip,
  media: 'video' | 'image',
  atFrame: number,
  fps: FrameRate,
  leadInFrames = 0
): GlTransitionSource {
  if (media === 'image') {
    return { assetId: clip.assetId as string, media, sourceFromFrame: 0, playbackRate: clip.speed }
  }
  const elapsed = atFrame - frameOfMicros(clip.startUs, fps)
  const sourceFromFrame =
    frameOfMicros(clip.sourceInUs, fps) +
    Math.round(elapsed * clip.speed) -
    Math.round(leadInFrames * clip.speed)
  return {
    assetId: clip.assetId as string,
    media,
    sourceFromFrame: Math.max(0, sourceFromFrame),
    playbackRate: clip.speed
  }
}
