import type { JSX } from 'react'
import {
  DEFAULT_TRANSITION_DURATION_US,
  type Clip,
  type TransitionKind
} from '../../../../shared/domain/timeline-track-types'
import { clipEndUs } from '../../../../shared/domain/timeline-track-types'
import { frameOfMicros } from '../../../../shared/domain/time-units'
import { resolveTransitionFrames } from '../../../../shared/domain/remotion-render-plan'
import { frameRateToNumber, type FrameRate } from '../../../../shared/domain/time-units'
import { interpolate, useT } from '../../i18n/use-translation'

/**
 * Chọn chuyển cảnh cho clip đang chọn.
 *
 * Điểm quan trọng của phần này: nó **nói ra khi thời lượng bị kẹp**. Chuyển cảnh
 * ăn vào phần nguồn nằm trước điểm vào của clip; không đủ thì nó tự ngắn lại. Nếu
 * giấu chuyện đó, người dùng đặt 1 giây rồi thấy hiệu ứng chớp qua trong 0,2 giây
 * mà không hiểu vì sao.
 */

const KINDS: Array<{ value: TransitionKind; labelKey: string }> = [
  { value: 'fade', labelKey: 'transitionFade' },
  { value: 'slide-left', labelKey: 'transitionSlideLeft' },
  { value: 'slide-right', labelKey: 'transitionSlideRight' },
  { value: 'slide-up', labelKey: 'transitionSlideUp' },
  { value: 'slide-down', labelKey: 'transitionSlideDown' },
  { value: 'wipe-left', labelKey: 'transitionWipeLeft' },
  { value: 'wipe-right', labelKey: 'transitionWipeRight' },
  { value: 'zoom', labelKey: 'transitionZoom' },
  { value: 'whip-left', labelKey: 'transitionWhipLeft' },
  { value: 'whip-right', labelKey: 'transitionWhipRight' },
  { value: 'blur', labelKey: 'transitionBlur' },
  { value: 'glitch', labelKey: 'transitionGlitch' },
  { value: 'spin', labelKey: 'transitionSpin' },
  { value: 'flash', labelKey: 'transitionFlash' }
]

export function ClipTransitionControls({
  clip,
  frameRate,
  edge = 'in',
  onChange
}: {
  clip: Clip
  frameRate: FrameRate
  /** Mép nào của clip — vào hay ra. */
  edge?: 'in' | 'out'
  onChange(transition: { kind: TransitionKind; durationUs: number } | undefined): void
}): JSX.Element {
  const t = useT()
  const current = edge === 'out' ? clip.transitionOut : clip.transitionIn
  const title = edge === 'out' ? t.inspector.exitTransition : t.inspector.transition

  // Tính bằng đúng hàm mà lớp dựng khung hình dùng, nên con số hiện ra là con số
  // thật. Hiệu ứng RA không tiêu thụ phần nguồn nào nên chỉ bị kẹp theo nửa clip.
  const usableFrames =
    edge === 'out'
      ? Math.min(
          frameOfMicros(current?.durationUs ?? 0, frameRate),
          Math.floor(
            (frameOfMicros(clipEndUs(clip), frameRate) - frameOfMicros(clip.startUs, frameRate)) / 2
          )
        )
      : resolveTransitionFrames(clip, frameRate)
  const usableSeconds = usableFrames / frameRateToNumber(frameRate)
  const wantedSeconds = (current?.durationUs ?? 0) / 1_000_000
  const clamped = Boolean(current) && usableSeconds + 0.001 < wantedSeconds

  return (
    <>
      <p className="field-group__title">{title}</p>

      <div className="field-row">
        <span className="field-row__label">{title}</span>
        <select
          value={current?.kind ?? ''}
          aria-label={title}
          onChange={(event) => {
            const kind = event.target.value as TransitionKind | ''
            onChange(
              kind
                ? { kind, durationUs: current?.durationUs ?? DEFAULT_TRANSITION_DURATION_US }
                : undefined
            )
          }}
        >
          <option value="">{t.inspector.transitionNone}</option>
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {t.inspector[option.labelKey as keyof typeof t.inspector] as string}
            </option>
          ))}
        </select>
      </div>

      {current && (
        <div className="field-row">
          <span className="field-row__label">{t.inspector.transitionDuration}</span>
          <input
            type="number"
            min={0.1}
            max={3}
            step={0.1}
            value={wantedSeconds}
            aria-label={`${title} — ${t.inspector.transitionDuration}`}
            onChange={(event) => {
              const seconds = Number(event.target.value)
              if (!Number.isFinite(seconds) || seconds <= 0) return
              onChange({ kind: current.kind, durationUs: Math.round(seconds * 1_000_000) })
            }}
          />
        </div>
      )}

      {/* Nói thẳng khi hiệu ứng bị cắt ngắn, thay vì để người dùng tự đoán. */}
      {clamped && (
        <p className="inspector__hint">
          {interpolate(t.inspector.transitionClamped, { seconds: usableSeconds.toFixed(2) })}
        </p>
      )}
      {edge === 'in' && <p className="inspector__hint">{t.inspector.transitionHint}</p>}
    </>
  )
}
