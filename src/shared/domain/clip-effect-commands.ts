import type { EditorCommand } from '../commands/editor-command-types'
import { findClipEffect } from './clip-effect-catalog'
import {
  clampEffectIntensity,
  defaultEffectParams,
  normalizeEffectParams,
  type ClipEffect,
  type EffectParamValue
} from './clip-effect-types'
import type { Clip } from './timeline-track-types'

/**
 * Lệnh sửa chồng effect của một clip. Mọi thao tác (thêm, sửa, gỡ, đổi thứ tự)
 * đều dựng lại CẢ mảng rồi gửi một `clip/set-effects`, nên giao diện, kéo-thả và
 * agent dùng chung một chỗ và mỗi thao tác là một bước hoàn tác.
 */

/** Thẻ Effects: dữ liệu kéo là `kind` trần. */
export const LIBRARY_EFFECT_DRAG_MIME = 'application/x-ai-video-studio-effect'

/** Giới hạn chồng: quá nhiều bộ lọc SVG thì preview không còn chạy nổi. */
export const MAX_CLIP_EFFECTS = 16

/** Cường độ khi mới thêm: đủ thấy rõ, chưa gắt. */
export const DEFAULT_EFFECT_INTENSITY = 0.7

type Planned = { commands: EditorCommand[]; label: string } | null

const setEffects = (clip: Clip, effects: ClipEffect[], label: string): Planned => ({
  commands: [{ type: 'clip/set-effects', clipId: clip.id, effects }],
  label
})

/** Effect mới với thông số mặc định, hoặc `null` nếu kind lạ. */
export function createClipEffect(kind: string, id: string): ClipEffect | null {
  const definition = findClipEffect(kind)
  if (!definition) return null
  return { id, kind, intensity: DEFAULT_EFFECT_INTENSITY, params: defaultEffectParams(definition) }
}

/** Thêm vào CUỐI chồng (áp sau cùng). Kind lạ hoặc chồng đã đầy thì `null`. */
export function addClipEffectCommands(
  clip: Clip,
  kind: string,
  id: string,
  overrides: { intensity?: number; params?: Record<string, EffectParamValue> } = {}
): Planned {
  const current = clip.effects ?? []
  const created = createClipEffect(kind, id)
  if (!created || current.length >= MAX_CLIP_EFFECTS) return null
  const definition = findClipEffect(kind)!
  const effect: ClipEffect = {
    ...created,
    intensity: clampEffectIntensity(overrides.intensity ?? created.intensity),
    params: normalizeEffectParams(definition, { ...created.params, ...overrides.params })
  }
  return setEffects(clip, [...current, effect], 'Thêm effect')
}

/** Đổi cường độ và/hoặc một phần thông số; thông số được kẹp theo danh mục. */
export function updateClipEffectCommands(
  clip: Clip,
  effectId: string,
  patch: { intensity?: number; params?: Record<string, EffectParamValue> }
): Planned {
  const effects = clip.effects ?? []
  const index = effects.findIndex((effect) => effect.id === effectId)
  if (index < 0) return null
  const effect = effects[index]
  const definition = findClipEffect(effect.kind)
  const next: ClipEffect = {
    ...effect,
    intensity:
      patch.intensity === undefined ? effect.intensity : clampEffectIntensity(patch.intensity),
    params: definition
      ? normalizeEffectParams(definition, { ...effect.params, ...patch.params })
      : { ...effect.params, ...patch.params }
  }
  return setEffects(
    clip,
    effects.map((item, at) => (at === index ? next : item)),
    'Chỉnh effect'
  )
}

export function removeClipEffectCommands(clip: Clip, effectId: string): Planned {
  const effects = clip.effects ?? []
  if (!effects.some((effect) => effect.id === effectId)) return null
  return setEffects(
    clip,
    effects.filter((effect) => effect.id !== effectId),
    'Gỡ effect'
  )
}

/** Dời một bậc lên (-1, áp sớm hơn) hoặc xuống (+1). Chạm đầu/cuối thì `null`. */
export function moveClipEffectCommands(clip: Clip, effectId: string, direction: -1 | 1): Planned {
  const effects = [...(clip.effects ?? [])]
  const index = effects.findIndex((effect) => effect.id === effectId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= effects.length) return null
  ;[effects[index], effects[target]] = [effects[target], effects[index]]
  return setEffects(clip, effects, 'Đổi thứ tự effect')
}
