import { useMemo, type JSX } from 'react'
import { formatClockTime, secondsToMicros } from '../../../../shared/domain/time-units'
import { rulerStepSeconds, usToPx } from './timeline-geometry'

/**
 * Thước thời gian phía trên các track.
 *
 * Vạch chia được tính theo mức zoom để nhãn không chồng lên nhau và luôn rơi vào
 * các mốc tròn (1s, 5s, 30s, 1 phút…), chứ không chia đều một cách máy móc.
 */
export function TimelineRuler({
  durationUs,
  pixelsPerSecond,
  widthPx
}: {
  durationUs: number
  pixelsPerSecond: number
  widthPx: number
}): JSX.Element {
  const ticks = useMemo(() => {
    const stepSeconds = rulerStepSeconds(pixelsPerSecond)
    const totalSeconds = Math.max(widthPx / pixelsPerSecond, durationUs / 1_000_000)
    const count = Math.ceil(totalSeconds / stepSeconds) + 1

    return Array.from({ length: count }, (_, index) => {
      const seconds = index * stepSeconds
      const us = secondsToMicros(seconds)
      return {
        us,
        x: usToPx(us, pixelsPerSecond),
        // Bỏ mili giây khi vạch cách nhau từ một giây trở lên: "00:01:30" dễ đọc
        // hơn "00:01:30.000" và tránh nhãn dài chồng nhau.
        label: formatClockTime(us, stepSeconds < 1)
      }
    })
  }, [durationUs, pixelsPerSecond, widthPx])

  return (
    <div className="timeline-ruler" style={{ width: widthPx }}>
      {ticks.map((tick) => (
        <div key={tick.us} className="timeline-ruler__tick" style={{ left: tick.x }}>
          <span className="timeline-ruler__label">{tick.label}</span>
        </div>
      ))}
    </div>
  )
}
