import type { JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { clipEndUs, type Clip, type Track } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'

/** Tab Basic: thông tin cơ bản của clip — tên, track, mốc thời gian. Chỉ đọc. */
export function ClipBasicSection({
  clip,
  track,
  asset
}: {
  clip: Clip
  track: Track
  asset: MediaAsset | undefined
}): JSX.Element {
  const t = useT()
  return (
    <>
      <p className="field-group__title">{t.inspector.clip}</p>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.clip}</span>
        <span className="field-row__value inspector__name" title={asset?.name}>
          {asset?.name ?? clip.label ?? '—'}
        </span>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.track}</span>
        <span className="field-row__value">{track.name}</span>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.start}</span>
        <span className="field-row__value">{formatClockTime(clip.startUs)}</span>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.duration}</span>
        <span className="field-row__value">
          {formatClockTime(clip.durationUs)}
          {' · '}
          {formatClockTime(clipEndUs(clip), false)}
        </span>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.sourceIn}</span>
        <span className="field-row__value">{formatClockTime(clip.sourceInUs)}</span>
      </div>
    </>
  )
}
