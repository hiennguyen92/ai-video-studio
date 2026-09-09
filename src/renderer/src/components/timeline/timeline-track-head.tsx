import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import {
  IconEye,
  IconEyeOff,
  IconLock,
  IconTrash,
  IconUnlock,
  IconVolume,
  IconVolumeOff
} from '../ui/icons'

/**
 * Đầu track ở cột trái của timeline.
 *
 * Nút hiển thị theo LOẠI track: track video không có nút tắt tiếng, track audio
 * không có nút ẩn hình (DESCRIPTION §4 "phù hợp với loại track"). Bày đủ mọi nút
 * cho mọi loại chỉ tạo ra các nút bấm không có tác dụng.
 */
type TrackUpdatePatch = Extract<EditorCommand, { type: 'track/update' }>['patch']

export function TimelineTrackHead({
  track,
  dragging,
  onReorderPointerDown
}: {
  track: Track
  /** Đang bị kéo để sắp lại thứ tự. */
  dragging: boolean
  onReorderPointerDown(event: ReactPointerEvent<HTMLElement>, trackId: string): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  // Số câu phụ đề của lane này. Lane rỗng nhìn giống hệt lane chưa gắn track phụ
  // đề nào, mà hai chuyện đó cần sửa theo hai cách khác nhau.
  const blockCount = useEditorStore((state) => {
    const document = state.session?.document
    if (!document) return null
    if (track.kind === 'text') {
      return document.textOverlays.filter((overlay) => overlay.trackId === track.id).length
    }
    if (track.kind !== 'subtitle') return null
    const subtitles = document.subtitleTracks.find((item) => item.id === track.subtitleTrackId)
    return subtitles?.cues.length ?? 0
  })

  const update = (patch: TrackUpdatePatch, label: string): void => {
    run([{ type: 'track/update', trackId: track.id, patch }], label)
  }

  return (
    <div
      className={`track-head ${dragging ? 'track-head--dragging' : ''}`}
      style={{ height: track.height }}
    >
      <div className="track-head__title">
        {/*
          Tay nắm riêng để kéo sắp lại thứ tự.
          
          Không cho kéo từ cả đầu lane: chỗ đó còn có nút ẩn, khoá, xoá, và một
          cú bấm hụt vào nút sẽ biến thành cú kéo. Tay nắm riêng thì ý định rõ
          ràng, và con trỏ đổi hình báo trước là kéo được.
        */}
        <span
          className="track-head__grip"
          role="button"
          tabIndex={-1}
          aria-label={t.timeline.reorderTrack}
          title={t.timeline.reorderTrack}
          onPointerDown={(event) => onReorderPointerDown(event, track.id)}
        >
          ⋮⋮
        </span>
        <span className="track-head__name" title={track.name}>
          {track.name}
        </span>
        {blockCount !== null && <span className="track-head__count">{blockCount}</span>}
      </div>

      <div className="track-head__controls">
        {/*
          Mọi lane VẼ RA HÌNH đều ẩn/hiện được — hình, phụ đề và chữ. Xem lại
          khung hình mà không có chữ che là việc làm thường xuyên.
        */}
        {track.kind !== 'audio' && (
          <ToolButton
            label={track.hidden ? t.timeline.show : t.timeline.hide}
            icon={track.hidden ? <IconEyeOff /> : <IconEye />}
            iconOnly
            active={track.hidden}
            onClick={() => update({ hidden: !track.hidden }, t.timeline.hide)}
          />
        )}

        {track.kind === 'audio' && (
          <>
            <ToolButton
              label={track.muted ? t.timeline.unmute : t.timeline.mute}
              icon={track.muted ? <IconVolumeOff /> : <IconVolume />}
              iconOnly
              active={track.muted}
              onClick={() => update({ muted: !track.muted }, t.timeline.mute)}
            />
            <ToolButton
              label={t.timeline.solo}
              icon={<span className="track-head__solo">S</span>}
              iconOnly
              active={track.solo}
              onClick={() => update({ solo: !track.solo }, t.timeline.solo)}
            />
          </>
        )}

        <ToolButton
          label={track.locked ? t.timeline.unlock : t.timeline.lock}
          icon={track.locked ? <IconLock /> : <IconUnlock />}
          iconOnly
          active={track.locked}
          onClick={() => update({ locked: !track.locked }, t.timeline.lock)}
        />

        <ToolButton
          label={t.timeline.removeTrack}
          icon={<IconTrash />}
          iconOnly
          variant="danger"
          disabled={track.locked}
          onClick={() => run([{ type: 'track/remove', trackId: track.id }], t.timeline.removeTrack)}
        />
      </div>
    </div>
  )
}
