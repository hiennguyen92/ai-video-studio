import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { findClipEffect } from '../../../../shared/domain/clip-effect-catalog'
import {
  moveClipEffectCommands,
  removeClipEffectCommands,
  updateClipEffectCommands
} from '../../../../shared/domain/clip-effect-commands'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useLocale, useT } from '../../i18n/use-translation'
import { ClipEffectParamField } from './clip-effect-param-field'
import { KeyframeDiamondButton } from './keyframe-diamond-button'
import { useKeyframeField } from './use-keyframe-field'
import { effectIntensityPath } from '../../../../shared/domain/keyframe-property-catalog'

/**
 * Chồng effect của clip đang chọn, theo đúng thứ tự áp (trên cùng áp trước).
 *
 * Thêm effect ở tab Effects của Library; ở đây chỉnh cường độ, thông số, đổi thứ
 * tự và gỡ. Effect kind lạ (dự án từ bản app mới hơn) vẫn hiện để gỡ được, chỉ
 * không có ô chỉnh.
 */
export function ClipEffectStackControls({
  clip,
  run
}: {
  clip: Clip
  run(commands: EditorCommand[], label: string): void
}): JSX.Element {
  const { t, locale } = useLocale()
  const effects = clip.effects ?? []
  const apply = (planned: { commands: EditorCommand[]; label: string } | null): void => {
    if (planned) run(planned.commands, planned.label)
  }

  return (
    <>
      <p className="field-group__title">{t.inspector.effects}</p>
      {effects.length === 0 && <p className="inspector__hint">{t.inspector.effectsEmpty}</p>}

      {effects.map((effect, index) => {
        const definition = findClipEffect(effect.kind)
        const name = definition
          ? locale === 'en'
            ? definition.nameEn
            : definition.nameVi
          : effect.kind
        const percent = Math.round(effect.intensity * 100)
        return (
          <div key={effect.id} className="effect-stack__item" data-effect-id={effect.id}>
            <div className="effect-stack__header">
              <span className="effect-stack__name">
                {index + 1}. {name}
              </span>
              <button
                type="button"
                className="button button--ghost effect-stack__button"
                disabled={index === 0}
                aria-label={t.inspector.effectMoveUp}
                title={t.inspector.effectMoveUp}
                onClick={() => apply(moveClipEffectCommands(clip, effect.id, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="button button--ghost effect-stack__button"
                disabled={index === effects.length - 1}
                aria-label={t.inspector.effectMoveDown}
                title={t.inspector.effectMoveDown}
                onClick={() => apply(moveClipEffectCommands(clip, effect.id, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="button button--ghost effect-stack__button"
                aria-label={`${t.inspector.effectRemove} ${name}`}
                title={t.inspector.effectRemove}
                onClick={() => apply(removeClipEffectCommands(clip, effect.id))}
              >
                ✕
              </button>
            </div>

            {definition?.usesIntensity && (
              <div className="field-row field-row--keyframable">
                <span className="field-row__label">{t.inspector.effectIntensity}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={percent}
                  aria-label={`${t.inspector.effectIntensity} ${name}`}
                  onChange={(event) =>
                    apply(
                      updateClipEffectCommands(clip, effect.id, {
                        intensity: Number(event.target.value) / 100
                      })
                    )
                  }
                />
                <span className="field-row__value">{percent}%</span>
                <EffectIntensityDiamond clipId={clip.id} effectId={effect.id} value={percent} />
              </div>
            )}

            {definition?.params.map((spec) => (
              <ClipEffectParamField
                key={spec.key}
                spec={spec}
                value={effect.params[spec.key]}
                locale={locale}
                clipId={clip.id}
                effectId={effect.id}
                onChange={(value) =>
                  apply(
                    updateClipEffectCommands(clip, effect.id, { params: { [spec.key]: value } })
                  )
                }
              />
            ))}
          </div>
        )
      })}
    </>
  )
}

/**
 * Nút kim cương cho thanh cường độ.
 *
 * Tách thành component riêng vì chỗ dùng nằm trong một vòng lặp qua các effect:
 * gọi hook thẳng trong thân vòng lặp là vi phạm quy tắc hook của React, còn một
 * component thì mỗi effect có phiên bản riêng của nó.
 */
function EffectIntensityDiamond({
  clipId,
  effectId,
  value
}: {
  clipId: string
  effectId: string
  value: number
}): JSX.Element {
  const t = useT()
  const field = useKeyframeField(
    { kind: 'clip', clipId },
    [effectIntensityPath(effectId)],
    t.inspector.effectIntensity
  )
  // Thanh hiện theo phần trăm còn tài liệu lưu 0..1 — chuyển ngay ở đây để chỗ
  // ghi không phải biết chuyện hiển thị.
  return (
    <KeyframeDiamondButton field={field} value={value / 100} label={t.inspector.effectIntensity} />
  )
}
