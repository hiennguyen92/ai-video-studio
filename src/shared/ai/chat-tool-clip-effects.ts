import type { EditorCommand } from '../commands/editor-command-types'
import { CLIP_EFFECTS, findClipEffect } from '../domain/clip-effect-catalog'
import {
  addClipEffectCommands,
  MAX_CLIP_EFFECTS,
  removeClipEffectCommands,
  updateClipEffectCommands
} from '../domain/clip-effect-commands'
import type { EffectParamValue } from '../domain/clip-effect-types'
import type { Clip } from '../domain/timeline-track-types'

/**
 * Dịch ba công cụ effect của agent thành lệnh, dùng CHUNG hàm dựng lệnh với tab
 * Effects và Inspector. Lỗi ném kèm gợi ý sửa (danh sách kind, id đang có) để agent
 * tự sửa ở lượt sau.
 */

type Planned = { description: string; commands: EditorCommand[] }

function effectIdsOf(clip: Clip): string {
  const effects = clip.effects ?? []
  return effects.length
    ? effects.map((effect) => `${effect.id} (${effect.kind})`).join(', ')
    : 'không có'
}

/** Thông số không có trong đặc tả: báo ra thay vì lặng lẽ bỏ, agent mới biết mình gõ sai. */
function assertKnownParams(
  kind: string,
  params: Record<string, EffectParamValue> | undefined
): void {
  const definition = findClipEffect(kind)
  if (!definition || !params) return
  const known = new Set(definition.params.map((param) => param.key))
  const unknown = Object.keys(params).filter((key) => !known.has(key))
  if (unknown.length) {
    throw new Error(
      `Effect "${kind}" không có thông số ${unknown.join(', ')}. Thông số hợp lệ: ${[...known].join(', ') || 'không có'}`
    )
  }
}

export function planAddClipEffect(
  clip: Clip,
  input: { kind: string; intensity?: number; params?: Record<string, EffectParamValue> },
  effectId: string
): Planned {
  const definition = findClipEffect(input.kind)
  if (!definition) {
    throw new Error(
      `Không có effect "${input.kind}". Chọn một trong: ${CLIP_EFFECTS.map((item) => item.kind).join(', ')}`
    )
  }
  assertKnownParams(input.kind, input.params)
  const planned = addClipEffectCommands(clip, input.kind, effectId, input)
  if (!planned) throw new Error(`Clip đã có đủ ${MAX_CLIP_EFFECTS} effect — gỡ bớt trước khi thêm`)
  return {
    description: `Thêm effect ${definition.nameVi} (id=${effectId}) vào clip`,
    commands: planned.commands
  }
}

export function planUpdateClipEffect(
  clip: Clip,
  input: { effectId: string; intensity?: number; params?: Record<string, EffectParamValue> }
): Planned {
  const effect = clip.effects?.find((item) => item.id === input.effectId)
  if (!effect) {
    throw new Error(
      `Clip không có effect "${input.effectId}". Effect đang có: ${effectIdsOf(clip)}`
    )
  }
  assertKnownParams(effect.kind, input.params)
  const planned = updateClipEffectCommands(clip, input.effectId, input)!
  return {
    description: `Chỉnh effect ${findClipEffect(effect.kind)?.nameVi ?? effect.kind} của clip`,
    commands: planned.commands
  }
}

export function planRemoveClipEffect(clip: Clip, input: { effectId?: string }): Planned {
  if (!input.effectId) {
    return {
      description: 'Gỡ hết effect của clip',
      commands: [{ type: 'clip/set-effects', clipId: clip.id, effects: [] }]
    }
  }
  const planned = removeClipEffectCommands(clip, input.effectId)
  if (!planned) {
    throw new Error(
      `Clip không có effect "${input.effectId}". Effect đang có: ${effectIdsOf(clip)}`
    )
  }
  return { description: 'Gỡ effect khỏi clip', commands: planned.commands }
}
