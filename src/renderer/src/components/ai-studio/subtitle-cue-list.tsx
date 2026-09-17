import type { JSX } from 'react'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import type { SubtitleTrack } from '../../../../shared/domain/subtitle-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { IconTrash } from '../ui/icons'
import { ToolButton } from '../ui/tool-button'

/** Danh sách câu của một track phụ đề: bấm mốc giờ để tua, sửa chữ tại chỗ, xoá câu. */
export function SubtitleCueList({ track }: { track: SubtitleTrack }): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const update = (cueId: string, patch: { text?: string; textSecondary?: string }): void => {
    run([{ type: 'subtitle/update-cue', trackId: track.id, cueId, ...patch }], 'Sửa phụ đề')
  }

  if (track.cues.length === 0) return <p className="subtitles-panel__hint">{t.subtitles.noCues}</p>

  return (
    <div className="cue-list">
      {track.cues.map((cue, index) => (
        <article key={cue.id} className="cue-row">
          <button
            type="button"
            className="cue-row__time"
            onClick={() => {
              setPlaying(false)
              // Nhích vào trong khoảng: đúng mốc bắt đầu là khung chữ còn đang mờ dần vào.
              setPlayhead(previewSeekUs(cue.startUs, cue.endUs))
            }}
            title={t.subtitles.seekHint}
          >
            {formatClockTime(cue.startUs)}
          </button>

          <div className="cue-row__body">
            <textarea
              className="cue-row__text"
              value={cue.text}
              rows={2}
              aria-label={`${t.subtitles.cuesSection} ${index + 1}`}
              onChange={(event) => update(cue.id, { text: event.target.value })}
            />
            {cue.textSecondary !== undefined && (
              <textarea
                className="cue-row__text cue-row__text--secondary"
                value={cue.textSecondary}
                rows={1}
                aria-label={`${t.subtitles.secondaryLine} ${index + 1}`}
                onChange={(event) => update(cue.id, { textSecondary: event.target.value })}
              />
            )}
          </div>

          <div className="cue-row__actions">
            {cue.edited && <span className="cue-row__badge">{t.subtitles.edited}</span>}
            <ToolButton
              label={t.subtitles.removeCue}
              icon={<IconTrash />}
              iconOnly
              variant="danger"
              onClick={() =>
                run(
                  [{ type: 'subtitle/remove-cue', trackId: track.id, cueId: cue.id }],
                  'Xoá câu phụ đề'
                )
              }
            />
          </div>
        </article>
      ))}
    </div>
  )
}
