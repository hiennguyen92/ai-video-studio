import type { JSX } from 'react'
import { formatClockTime } from '../../../../shared/domain/time-units'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { SliderRow } from './inspector-slider-row'

/** Tab Audio: âm lượng và fade vào/ra của clip. */
export function ClipAudioSection({
  clip,
  onUpdate
}: {
  clip: Clip
  onUpdate(patch: { volume?: number; fadeInUs?: number; fadeOutUs?: number }, label: string): void
}): JSX.Element {
  const t = useT()
  const maxFadeUs = Math.min(clip.durationUs, 5_000_000)
  return (
    <>
      <p className="field-group__title">{t.inspector.volume}</p>
      <SliderRow
        label={t.inspector.volume}
        value={clip.volume}
        min={0}
        max={2}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(value) => onUpdate({ volume: value }, t.inspector.volume)}
      />
      <SliderRow
        label={t.inspector.fadeIn}
        value={clip.fadeInUs}
        min={0}
        max={maxFadeUs}
        step={10_000}
        format={(value) => formatClockTime(value)}
        onCommit={(value) => onUpdate({ fadeInUs: Math.round(value) }, t.inspector.fadeIn)}
      />
      <SliderRow
        label={t.inspector.fadeOut}
        value={clip.fadeOutUs}
        min={0}
        max={maxFadeUs}
        step={10_000}
        format={(value) => formatClockTime(value)}
        onCommit={(value) => onUpdate({ fadeOutUs: Math.round(value) }, t.inspector.fadeOut)}
      />
    </>
  )
}
