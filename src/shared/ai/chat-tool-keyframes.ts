import {
  effectIntensityPath,
  effectParamPath,
  resolveClipProperty,
  resolveTextProperty
} from '../domain/keyframe-property-catalog'
import type { Clip } from '../domain/timeline-track-types'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Micros } from '../domain/time-units'

/**
 * Cầu nối giữa cách AGENT gọi tên một thuộc tính và đường dẫn nội bộ của nó.
 *
 * Agent nói `opacity`, tài liệu lưu `transform.opacity`. Bắt agent gõ đường dẫn
 * nội bộ vừa khó nhớ vừa mở đường cho nó bịa ra đường dẫn không tồn tại — bảng
 * này là DANH SÁCH TRẮNG, nên không có cách nào ghi vào một khoá ngoài danh mục.
 */

/** Tên thuộc tính mà công cụ nhận, cho clip hình. */
export const CLIP_KEYFRAME_PROPERTIES = {
  opacity: 'transform.opacity',
  scale: 'transform.scale',
  x: 'transform.x',
  y: 'transform.y',
  rotation: 'transform.rotationDeg',
  volume: 'volume',
  effect_intensity: 'effect',
  effect_param: 'effect'
} as const

/** Tên thuộc tính cho chữ overlay. */
export const TEXT_KEYFRAME_PROPERTIES = {
  text_x: 'style.position.xPct',
  text_y: 'style.position.yPct',
  font_size: 'style.fontSizePx',
  text_rotation: 'style.rotationDeg'
} as const

export type KeyframeToolProperty =
  keyof typeof CLIP_KEYFRAME_PROPERTIES | keyof typeof TEXT_KEYFRAME_PROPERTIES

export const KEYFRAME_TOOL_PROPERTIES = [
  ...Object.keys(CLIP_KEYFRAME_PROPERTIES),
  ...Object.keys(TEXT_KEYFRAME_PROPERTIES)
] as [KeyframeToolProperty, ...KeyframeToolProperty[]]

export interface KeyframeToolInput {
  clipId?: string
  overlayId?: string
  property: KeyframeToolProperty
  effectId?: string
  paramKey?: string
  atSeconds: number
}

export interface ResolvedKeyframeTool {
  target: { kind: 'clip'; clipId: string } | { kind: 'text'; overlayId: string }
  path: string
  atUs: Micros
  /** Tên người đọc được, để ghép vào mô tả bước sẽ áp dụng. */
  label: string
}

/**
 * Đổi tham số của công cụ thành đích ghi thật, hoặc ném lỗi TIẾNG VIỆT.
 *
 * Ném ngay tại đây thay vì để reducer từ chối sau: người dùng nhìn thấy lỗi
 * trước khi bấm áp dụng, và câu lỗi nói đúng thứ họ gõ ra chứ không nói bằng
 * đường dẫn nội bộ.
 */
export function resolveKeyframeTool(
  document: ProjectDocument,
  input: KeyframeToolInput,
  resolveClipId: (clipId?: string) => string
): ResolvedKeyframeTool {
  const atUs = Math.round(input.atSeconds * 1_000_000)
  const isText = input.property in TEXT_KEYFRAME_PROPERTIES

  if (isText) {
    const overlayId = input.overlayId
    if (!overlayId) throw new Error('Thiếu overlayId: thuộc tính này thuộc về chữ overlay')
    const overlay = document.textOverlays.find((item) => item.id === overlayId)
    if (!overlay) throw new Error(`Không tìm thấy chữ overlay "${overlayId}"`)

    const path = TEXT_KEYFRAME_PROPERTIES[input.property as keyof typeof TEXT_KEYFRAME_PROPERTIES]
    if (!resolveTextProperty(overlay, path)) {
      throw new Error(`Không đặt keyframe được cho "${input.property}"`)
    }
    assertInside(atUs, overlay.endUs - overlay.startUs, 'chữ overlay')
    return { target: { kind: 'text', overlayId }, path, atUs, label: input.property }
  }

  const clipId = resolveClipId(input.clipId)
  const clip = findClip(document, clipId)
  if (!clip) throw new Error(`Không tìm thấy clip "${clipId}"`)

  const path = clipPathOf(clip, input)
  if (!resolveClipProperty(clip, path)) {
    throw new Error(`Không đặt keyframe được cho "${input.property}" trên clip này`)
  }
  assertInside(atUs, clip.durationUs, 'clip')
  return { target: { kind: 'clip', clipId }, path, atUs, label: input.property }
}

function clipPathOf(clip: Clip, input: KeyframeToolInput): string {
  if (input.property !== 'effect_intensity' && input.property !== 'effect_param') {
    return CLIP_KEYFRAME_PROPERTIES[input.property as keyof typeof CLIP_KEYFRAME_PROPERTIES]
  }

  const effectId = input.effectId
  if (!effectId) throw new Error('Thiếu effectId: thuộc tính này thuộc về một effect cụ thể')
  if (!clip.effects?.some((effect) => effect.id === effectId)) {
    throw new Error(`Clip không có effect nào mang id "${effectId}"`)
  }

  if (input.property === 'effect_intensity') return effectIntensityPath(effectId)
  if (!input.paramKey) throw new Error('Thiếu paramKey: cần tên thông số của effect')
  return effectParamPath(effectId, input.paramKey)
}

/**
 * Mốc phải nằm TRONG chủ thể.
 *
 * `atSeconds` ở đây là offset tính từ đầu clip, khác `atSeconds` của công cụ cắt
 * clip vốn là mốc tuyệt đối trên timeline. Agent nhầm hai hệ quy chiếu này là
 * chuyện rất dễ xảy ra, và nếu không chặn thì keyframe rơi ra ngoài chỗ nhìn
 * thấy được — sai một cách hoàn toàn im lặng.
 */
function assertInside(atUs: Micros, durationUs: Micros, what: string): void {
  if (atUs > durationUs) {
    throw new Error(
      `Mốc ${(atUs / 1_000_000).toFixed(2)}s vượt quá độ dài ${what} ` +
        `(${(durationUs / 1_000_000).toFixed(2)}s). Mốc tính TỪ ĐẦU ${what}, không phải giờ trên timeline.`
    )
  }
}

function findClip(document: ProjectDocument, clipId: string): Clip | undefined {
  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === clipId)
    if (clip) return clip
  }
  return undefined
}

/** Dùng cho phần tóm tắt trong ngữ cảnh: khoảng thời gian một đường keyframe trải ra. */
export function keyframeSpanLabel(frames: Array<{ atUs: Micros }>): string {
  if (frames.length === 0) return ''
  const first = frames[0].atUs / 1_000_000
  const last = frames[frames.length - 1].atUs / 1_000_000
  return `${frames.length}@${first.toFixed(1)}–${last.toFixed(1)}s`
}
