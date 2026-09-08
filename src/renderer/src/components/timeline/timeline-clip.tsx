import { useCallback, useMemo, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import {
  clipSourceOutUs,
  type Clip,
  type Track
} from '../../../../shared/domain/timeline-track-types'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { usToPx } from './timeline-geometry'
import { reducePeaksToColumns, useWaveformPeaks } from '../../hooks/use-waveform-peaks'

/**
 * Một clip trên timeline.
 *
 * Vẽ nền bằng filmstrip (video) hoặc dạng sóng (audio) để nhìn là biết đang cắt
 * đoạn nào, thay vì một khối màu trơn không mang thông tin.
 */

export type ClipDragMode = 'move' | 'trim-start' | 'trim-end'

/** Bề rộng vùng bắt chuột để kéo mép clip. */
const TRIM_HANDLE_PX = 7

const TRACK_ROLE_COLOR: Record<string, string> = {
  video: 'var(--track-video)',
  voiceover: 'var(--track-voiceover)',
  music: 'var(--track-music)',
  sfx: 'var(--track-sfx)',
  dialogue: 'var(--track-dialogue)'
}

function clipColor(track: Track): string {
  if (track.kind === 'video') return TRACK_ROLE_COLOR.video
  if (track.kind === 'subtitle') return 'var(--track-subtitle)'
  return TRACK_ROLE_COLOR[track.role ?? 'dialogue'] ?? 'var(--track-dialogue)'
}

export function TimelineClip({
  clip,
  track,
  asset,
  pixelsPerSecond,
  selected,
  onPointerDown
}: {
  clip: Clip
  track: Track
  asset: MediaAsset | undefined
  pixelsPerSecond: number
  selected: boolean
  onPointerDown(event: ReactPointerEvent<HTMLElement>, clip: Clip, mode: ClipDragMode): void
}): JSX.Element {
  const left = usToPx(clip.startUs, pixelsPerSecond)
  const width = usToPx(clip.durationUs, pixelsPerSecond)
  const color = clipColor(track)

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (track.locked) return
      const bounds = event.currentTarget.getBoundingClientRect()
      const offsetX = event.clientX - bounds.left

      const mode: ClipDragMode =
        offsetX <= TRIM_HANDLE_PX
          ? 'trim-start'
          : offsetX >= bounds.width - TRIM_HANDLE_PX
            ? 'trim-end'
            : 'move'

      onPointerDown(event, clip, mode)
    },
    [clip, track.locked, onPointerDown]
  )

  // Filmstrip là một ảnh sprite ngang; kéo giãn theo bề rộng clip để khớp thời lượng.
  const filmstripStyle =
    asset?.derived.filmstripPath && asset.probe.durationUs > 0
      ? {
          backgroundImage: `url(${mediaFileUrl(asset.derived.filmstripPath)})`,
          // Sprite trải trên toàn bộ asset, nên phần hiện ra phải theo tỉ lệ clip cắt.
          backgroundSize: `${usToPx(asset.probe.durationUs / clip.speed, pixelsPerSecond)}px 100%`,
          backgroundPositionX: `${-usToPx(clip.sourceInUs / clip.speed, pixelsPerSecond)}px`
        }
      : undefined

  const fadeInWidth = usToPx(clip.fadeInUs, pixelsPerSecond)
  const fadeOutWidth = usToPx(clip.fadeOutUs, pixelsPerSecond)

  return (
    <div
      className={`timeline-clip ${selected ? 'timeline-clip--selected' : ''} ${track.locked ? 'timeline-clip--locked' : ''}`}
      style={{
        left: `${left}px`,
        width: `${Math.max(2, width)}px`,
        // Dải màu đậm ở mép trái giúp phân biệt loại track khi nhiều clip liền nhau.
        borderLeftColor: color,
        background: `color-mix(in srgb, ${color} 22%, var(--surface-raised))`
      }}
      onPointerDown={handlePointerDown}
      role="button"
      tabIndex={0}
      aria-label={`${asset?.name ?? clip.label ?? 'clip'} · ${formatClockTime(clip.durationUs, false)}`}
      title={`${asset?.name ?? clip.label ?? ''}\n${formatClockTime(clip.startUs)} → ${formatClockTime(clip.startUs + clip.durationUs)}`}
    >
      {filmstripStyle && <div className="timeline-clip__filmstrip" style={filmstripStyle} />}

      {asset?.derived.waveformPath && track.kind === 'audio' && (
        <WaveformStrip asset={asset} clip={clip} pixelsPerSecond={pixelsPerSecond} color={color} />
      )}

      {fadeInWidth > 1 && (
        <div
          className="timeline-clip__fade timeline-clip__fade--in"
          style={{ width: fadeInWidth }}
        />
      )}
      {fadeOutWidth > 1 && (
        <div
          className="timeline-clip__fade timeline-clip__fade--out"
          style={{ width: fadeOutWidth }}
        />
      )}

      <span className="timeline-clip__label">{asset?.name ?? clip.label ?? ''}</span>

      {!track.locked && (
        <>
          <span className="timeline-clip__handle timeline-clip__handle--start" />
          <span className="timeline-clip__handle timeline-clip__handle--end" />
        </>
      )}
    </div>
  )
}

/**
 * Dạng sóng vẽ bằng SVG, dựng từ peak THẬT đã trích lúc import.
 *
 * Chưa nạp xong thì không vẽ gì. Vẽ một đường sóng bịa cho "đỡ trống" sẽ khiến
 * người dùng cắt vào chỗ họ tưởng là im lặng — dạng sóng phải đúng hoặc không có.
 */
function WaveformStrip({
  asset,
  clip,
  pixelsPerSecond,
  color
}: {
  asset: MediaAsset
  clip: Clip
  pixelsPerSecond: number
  color: string
}): JSX.Element | null {
  const data = useWaveformPeaks(asset.derived.waveformPath)
  const width = Math.max(2, usToPx(clip.durationUs, pixelsPerSecond))
  const columnCount = Math.min(600, Math.max(4, Math.floor(width / 2)))

  const columns = useMemo(() => {
    if (!data) return []
    return reducePeaksToColumns(data, clip.sourceInUs, clipSourceOutUs(clip), columnCount)
  }, [data, clip, columnCount])

  if (columns.length === 0) return null

  return (
    <svg
      className="timeline-clip__waveform"
      viewBox={`0 0 ${columns.length} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {columns.map((amplitude, index) => (
        <rect
          key={index}
          x={index + 0.1}
          y={50 - amplitude * 48}
          width={0.8}
          height={Math.max(1, amplitude * 96)}
          fill={color}
          opacity={0.6}
        />
      ))}
    </svg>
  )
}
