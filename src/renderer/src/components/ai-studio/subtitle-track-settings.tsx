import type { JSX } from 'react'
import { createId } from '../../../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { rebuildTrackCues } from '../../../../shared/domain/subtitle-track-source'
import type { SubtitleTrack } from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { IconTrash } from '../ui/icons'
import { ToolButton } from '../ui/tool-button'

/** Tên track, dựng lại cue từ nguồn của track, xoá track. */
export function SubtitleTrackSettings({
  document,
  track
}: {
  document: ProjectDocument
  track: SubtitleTrack
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const rebuilt = rebuildTrackCues(document, track, () => createId('cue'))

  return (
    <>
      <div className="field-row">
        <span className="field-row__label">{t.subtitles.trackName}</span>
        <input
          type="text"
          value={track.name}
          aria-label={t.subtitles.trackName}
          onChange={(event) =>
            run(
              [
                {
                  type: 'subtitle/rename-track',
                  trackId: track.id,
                  name: event.target.value || track.name
                }
              ],
              'Đổi tên track phụ đề'
            )
          }
        />
      </div>

      <div className="subtitles-panel__actions">
        <ToolButton
          label={t.subtitles.rebuild}
          variant="outline"
          disabled={!rebuilt}
          onClick={() => {
            if (!rebuilt) return
            if (!window.confirm(t.subtitles.rebuildWarning)) return
            run(
              [{ type: 'subtitle/replace-cues', trackId: track.id, cues: rebuilt }],
              'Dựng lại phụ đề'
            )
          }}
        />
        <ToolButton
          label={t.subtitles.deleteTrack}
          icon={<IconTrash />}
          variant="danger"
          onClick={() =>
            run([{ type: 'subtitle/remove-track', trackId: track.id }], 'Xoá track phụ đề')
          }
        />
      </div>
    </>
  )
}
