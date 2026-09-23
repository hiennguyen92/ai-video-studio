import {
  useCallback,
  useMemo,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { useEditorStore } from '../../state/editor-store'
import {
  clipSourceOutUs,
  type Clip,
  type Track
} from '../../../../shared/domain/timeline-track-types'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { usToPx } from './timeline-geometry'
import { reducePeaksToColumns, useWaveformPeaks } from '../../hooks/use-waveform-peaks'
import { useLibraryClipDrop } from '../library/use-library-clip-drop'
import { TimelineClipFilmstrip } from './timeline-clip-filmstrip'
import { TimelineClipTags } from './timeline-clip-tags'
import { useClipTagDescriptions } from './use-clip-tag-descriptions'
import { IconLink } from '../ui/icons'
import { useT } from '../../i18n/use-translation'

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
  grouped = false,
  dragBadge,
  onPointerDown
}: {
  clip: Clip
  track: Track
  asset: MediaAsset | undefined
  pixelsPerSecond: number
  selected: boolean
  /** Clip nằm trong nhóm còn thành viên khác — hiện icon mắt xích cạnh tên. */
  grouped?: boolean
  /** Chữ nhỏ hiện trên clip lúc đang kéo (tốc độ mới khi rate stretch, điểm vào khi slip). */
  dragBadge?: string
  onPointerDown(event: ReactPointerEvent<HTMLElement>, clip: Clip, mode: ClipDragMode): void
}): JSX.Element {
  const t = useT()
  const isBlade = useEditorStore((state) => state.timelineTool === 'blade')
  // Chế độ Blade: vạch dọc theo con trỏ cho thấy chỗ sẽ cắt trước khi bấm.
  const [bladeX, setBladeX] = useState<number | null>(null)
  const left = usToPx(clip.startUs, pixelsPerSecond)
  const width = usToPx(clip.durationUs, pixelsPerSecond)
  const color = clipColor(track)
  // Nhận thẻ zoom kéo từ tab Library. Chuyển cảnh thì lane nhận, ở chỗ nối.
  const { dropActive, dropProps } = useLibraryClipDrop(clip, track)

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

  const tagLines = useClipTagDescriptions(clip)
    .map((item) => `\n${item.full}`)
    .join('')
  const fadeInWidth = usToPx(clip.fadeInUs, pixelsPerSecond)
  const fadeOutWidth = usToPx(clip.fadeOutUs, pixelsPerSecond)

  return (
    <div
      className={`timeline-clip ${selected ? 'timeline-clip--selected' : ''} ${track.locked ? 'timeline-clip--locked' : ''} ${dropActive ? 'timeline-clip--drop' : ''}`}
      style={{
        left: `${left}px`,
        width: `${Math.max(2, width)}px`,
        // Dải màu đậm ở mép trái giúp phân biệt loại track khi nhiều clip liền nhau.
        borderLeftColor: color,
        background: `color-mix(in srgb, ${color} 22%, var(--surface-raised))`
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={
        isBlade
          ? (event) => setBladeX(event.clientX - event.currentTarget.getBoundingClientRect().left)
          : undefined
      }
      onPointerLeave={isBlade ? () => setBladeX(null) : undefined}
      {...dropProps}
      role="button"
      tabIndex={0}
      aria-label={`${asset?.name ?? clip.label ?? 'clip'} · ${formatClockTime(clip.durationUs, false)}${grouped ? ` · ${t.timeline.groupedClip}` : ''}`}
      title={`${asset?.name ?? clip.label ?? ''}\n${formatClockTime(clip.startUs)} → ${formatClockTime(clip.startUs + clip.durationUs)}${grouped ? `\n${t.timeline.groupedClip}` : ''}${tagLines}`}
    >
      {asset && asset.derived.filmstripPath && asset.probe.durationUs > 0 && (
        <TimelineClipFilmstrip
          asset={asset}
          clip={clip}
          widthPx={width}
          pixelsPerSecond={pixelsPerSecond}
          trackHeightPx={track.height}
        />
      )}

      {asset?.derived.waveformPath && track.kind === 'audio' && (
        <WaveformStrip asset={asset} clip={clip} pixelsPerSecond={pixelsPerSecond} color={color} />
      )}
      {/* Clip quay có tiếng: sóng âm ở dải dưới, dưới dải hình. Cắt lời hay tìm chỗ
          ngắt câu trên lane hình trước đây phải đoán mò vì chỉ thấy khung hình. Clip
          đã tắt tiếng thì không vẽ — sóng âm của thứ không phát ra là thông tin sai. */}
      {asset?.derived.waveformPath && track.kind === 'video' && clip.volume > 0 && (
        <WaveformStrip
          asset={asset}
          clip={clip}
          pixelsPerSecond={pixelsPerSecond}
          color="#ffffff"
          className="timeline-clip__waveform timeline-clip__waveform--below-picture"
        />
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

      <span className="timeline-clip__label">
        {grouped && <IconLink className="timeline-clip__group-icon" width={10} height={10} />}
        {asset?.name ?? clip.label ?? ''}
      </span>

      <TimelineClipTags clip={clip} />

      {dragBadge && <span className="timeline-clip__drag-badge">{dragBadge}</span>}
      {isBlade && bladeX !== null && (
        <span className="timeline-clip__blade-line" style={{ left: bladeX }} aria-hidden />
      )}

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
  color,
  className = 'timeline-clip__waveform'
}: {
  asset: MediaAsset
  clip: Clip
  pixelsPerSecond: number
  color: string
  className?: string
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
      className={className}
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
