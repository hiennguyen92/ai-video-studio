import type { JSX } from 'react'
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

export function TimelineTrackHead({ track }: { track: Track }): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  // Số câu phụ đề của lane này. Lane rỗng nhìn giống hệt lane chưa gắn track phụ
  // đề nào, mà hai chuyện đó cần sửa theo hai cách khác nhau.
  const cueCount = useEditorStore((state) => {
    if (track.kind !== 'subtitle') return null
    const subtitles = state.session?.document.subtitleTracks.find(
      (item) => item.id === track.subtitleTrackId
    )
    return subtitles?.cues.length ?? 0
  })

  const update = (patch: TrackUpdatePatch, label: string): void => {
    run([{ type: 'track/update', trackId: track.id, patch }], label)
  }

  return (
    <div className="track-head" style={{ height: track.height }}>
      <div className="track-head__title">
        <span className="track-head__name" title={track.name}>
          {track.name}
        </span>
        {cueCount !== null && <span className="track-head__count">{cueCount}</span>}
      </div>

      <div className="track-head__controls">
        {track.kind === 'video' && (
          <ToolButton
            label={track.hidden ? t.timeline.show : t.timeline.hide}
            icon={track.hidden ? <IconEyeOff /> : <IconEye />}
            iconOnly
            active={track.hidden}
            onClick={() => update({ hidden: !track.hidden }, t.timeline.hide)}
          />
        )}

        {/*
          Lane phụ đề cũng cần ẩn/hiện: xem lại hình mà không có chữ che là việc
          làm thường xuyên, và trước đây chỉ track hình mới có nút này.
        */}
        {track.kind === 'subtitle' && (
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
