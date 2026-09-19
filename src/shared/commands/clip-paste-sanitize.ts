import { cloneKeyframes } from '../domain/keyframe-clip-edits'
import { findClipEffect } from '../domain/clip-effect-catalog'
import { clampEffectIntensity, normalizeEffectParams } from '../domain/clip-effect-types'
import type { Clip } from '../domain/timeline-track-types'
import type { Micros } from '../domain/time-units'

/**
 * Dựng lại một clip từ payload dán, chỉ lấy những trường đã biết.
 *
 * Lệnh dán mang cả clip qua `z.custom`, tức là zod chỉ kiểm "có phải object
 * không". Payload tới được từ agent hoặc từ file dự án sửa tay, nên chỗ này
 * KHÔNG tin nó: mỗi trường được lấy ra tường minh, mỗi con số bị kẹp, và trường
 * lạ thì rơi ra ngoài thay vì chui vào tài liệu.
 *
 * Keyframe sao chép SÂU: bản dán và bản gốc dùng chung mảng là sửa cái này đổi
 * cái kia.
 */
export function sanitizeClipForPaste(
  source: Clip,
  options: { id: string; startUs: Micros }
): Clip | null {
  const durationUs = Math.round(Number(source.durationUs))
  if (!Number.isFinite(durationUs) || durationUs <= 0) return null
  if (!source.assetId) return null

  const speed = clamp(numberOr(source.speed, 1), 0.1, 10)
  const clip: Clip = {
    id: options.id,
    assetId: source.assetId,
    startUs: Math.max(0, Math.round(options.startUs)),
    durationUs,
    sourceInUs: Math.max(0, Math.round(Number(source.sourceInUs) || 0)),
    speed,
    volume: clamp(numberOr(source.volume, 1), 0, 2),
    fadeInUs: clampMicros(source.fadeInUs, durationUs),
    fadeOutUs: clampMicros(source.fadeOutUs, durationUs),
    // Nhóm liên kết KHÔNG đi theo: bản dán là một clip độc lập, không phải mảnh
    // thứ hai của cặp hình-tiếng vốn tách ra từ cùng một file.
    linkGroupId: undefined
  }

  if (source.label) clip.label = String(source.label).slice(0, 200)
  if (source.transform) clip.transform = { ...source.transform }
  if (source.motion) clip.motion = { ...source.motion }
  if (source.colorGrade) clip.colorGrade = { ...source.colorGrade }
  if (source.look) clip.look = { ...source.look }
  if (source.transitionIn) clip.transitionIn = { ...source.transitionIn }
  if (source.transitionOut) clip.transitionOut = { ...source.transitionOut }
  if (source.effects?.length) {
    // Kind lạ bị bỏ hẳn, thông số được kẹp về khoảng của chính effect đó —
    // cùng cách lớp dựng kế hoạch đối xử với chồng effect đọc từ file.
    const effects = source.effects
      .map((effect) => {
        const definition = findClipEffect(effect.kind)
        if (!definition) return null
        return {
          id: String(effect.id),
          kind: effect.kind,
          intensity: clampEffectIntensity(effect.intensity),
          params: normalizeEffectParams(definition, effect.params)
        }
      })
      .filter((effect): effect is NonNullable<typeof effect> => effect !== null)
    if (effects.length) clip.effects = effects
  }
  const keyframes = cloneKeyframes(source.keyframes)
  if (keyframes) clip.keyframes = keyframes

  return clip
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * Số, hoặc giá trị thay thế khi payload thiếu/hỏng.
 *
 * Quan trọng với âm lượng: kẹp thẳng một `undefined` sẽ ra 0, tức bản dán im
 * tiếng — một kiểu mất dữ liệu rất khó ngờ tới khi nhìn clip trên timeline.
 */
function numberOr(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function clampMicros(value: unknown, durationUs: Micros): Micros {
  const number = Math.round(Number(value) || 0)
  return Math.min(durationUs, Math.max(0, number))
}
