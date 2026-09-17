import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  CUT_TRANSITION_DURATIONS_US,
  cutTransitionDurationUs,
  findCutPoints,
  removeCutTransitionCommands,
  setCutTransitionDurationCommands,
  type CutPoint
} from '../../../../shared/domain/timeline-cut-transitions'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { interpolate, useLocale } from '../../i18n/use-translation'
import { TRANSITION_LABEL_KEYS } from '../library/clip-effect-labels'

/**
 * Chuyển cảnh ở hai đầu clip đang chọn.
 *
 * Chuyển cảnh thuộc về CHỖ NỐI chứ không thuộc riêng clip (xem
 * `timeline-cut-transitions`), nên đổi thời lượng hay xoá ở đây đi qua đúng lệnh
 * của chỗ nối: sửa "Ra" của clip này là sửa luôn "Vào" của clip liền sau. Đặt kiểu
 * mới vẫn là kéo thẻ Library vào chỗ nối trên timeline.
 */
export function ClipCutTransitionControls({
  clip,
  track,
  run
}: {
  clip: Clip
  track: Track
  run(commands: EditorCommand[], label: string): void
}): JSX.Element {
  const { t, locale } = useLocale()
  const points = findCutPoints(track)
  const edges: Array<{ edge: 'in' | 'out'; point: CutPoint }> = []
  const incoming = points.find((point) => point.rightClip?.id === clip.id && point.kind)
  const outgoing = points.find((point) => point.leftClip?.id === clip.id && point.kind)
  if (incoming) edges.push({ edge: 'in', point: incoming })
  if (outgoing) edges.push({ edge: 'out', point: outgoing })

  const seconds = (durationUs: number): string =>
    interpolate(t.timeline.cutTransitionSeconds, {
      seconds: (durationUs / 1_000_000).toLocaleString(locale === 'en' ? 'en' : 'vi')
    })

  return (
    <>
      <p className="field-group__title">{t.inspector.transitions}</p>
      {edges.length === 0 && <p className="inspector__hint">{t.inspector.transitionsEmpty}</p>}
      {edges.map(({ edge, point }) => {
        const edgeLabel = edge === 'in' ? t.inspector.transitionIn : t.inspector.transitionOut
        const name = point.kind ? t.inspector[TRANSITION_LABEL_KEYS[point.kind]] : ''
        const current = cutTransitionDurationUs(point)
        // Thời lượng lẻ (dự án cũ, agent đặt 0,7 giây) vẫn phải hiện đúng trong ô chọn.
        const options =
          current && !CUT_TRANSITION_DURATIONS_US.includes(current)
            ? [...CUT_TRANSITION_DURATIONS_US, current].sort((a, b) => a - b)
            : CUT_TRANSITION_DURATIONS_US
        return (
          <div key={edge} className="effect-stack__item" data-transition-edge={edge}>
            <div className="effect-stack__header">
              <span className="effect-stack__name">
                {edgeLabel}: {name}
              </span>
              <button
                type="button"
                className="button button--ghost effect-stack__button"
                aria-label={`${t.timeline.removeCutTransitionShort} (${edgeLabel})`}
                title={t.timeline.removeCutTransitionShort}
                onClick={() =>
                  run(removeCutTransitionCommands(point), t.timeline.removeCutTransitionShort)
                }
              >
                ✕
              </button>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.duration}</span>
              <select
                value={current ?? ''}
                aria-label={`${t.timeline.cutTransitionDuration} (${edgeLabel})`}
                onChange={(event) =>
                  run(
                    setCutTransitionDurationCommands(point, Number(event.target.value)),
                    t.timeline.cutTransitionDuration
                  )
                }
              >
                {options.map((durationUs) => (
                  <option key={durationUs} value={durationUs}>
                    {seconds(durationUs)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )
      })}
    </>
  )
}
