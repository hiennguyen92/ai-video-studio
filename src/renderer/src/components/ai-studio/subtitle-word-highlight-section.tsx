import { useMemo, useState, type JSX } from 'react'
import { createId } from '../../../../shared/domain/project-document-factory'
import type { SubtitleTrack } from '../../../../shared/domain/subtitle-types'
import { splitCuesIntoWordChunks } from '../../../../shared/domain/subtitle-word-timing'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { ToolButton } from '../ui/tool-button'
import { ColorRow } from './style-field-rows'

const DEFAULT_HIGHLIGHT_COLOR = '#FFE45C'

/**
 * Phụ đề nổi bật từng chữ: kiểu tô, màu, và chia câu thành cụm ngắn.
 *
 * Hai việc đi cùng nhau vì người làm video ngắn gần như luôn cần cả hai: câu dài
 * cả dòng mà chỉ một chữ sáng thì mắt phải đuổi theo chữ sáng khắp màn hình.
 */
export function SubtitleWordHighlightSection({ track }: { track: SubtitleTrack }): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const [chunkSize, setChunkSize] = useState(3)
  const highlight = track.style.wordHighlight

  const size = Math.min(8, Math.max(1, Math.round(chunkSize) || 1))
  const chunked = useMemo(
    () => splitCuesIntoWordChunks(track.cues, size, () => createId('cue')),
    [track.cues, size]
  )
  const changes = chunked.length !== track.cues.length

  const setHighlight = (next: SubtitleTrack['style']['wordHighlight']): void => {
    run(
      [
        {
          type: 'subtitle/set-style',
          trackId: track.id,
          style: { ...track.style, wordHighlight: next }
        }
      ],
      t.wordHighlight.styleLabel
    )
  }

  return (
    <>
      <div className="field-row">
        <span className="field-row__label">{t.wordHighlight.mode}</span>
        <select
          aria-label={t.wordHighlight.mode}
          value={highlight?.mode ?? 'off'}
          onChange={(event) => {
            const mode = event.target.value
            setHighlight(
              mode === 'word' || mode === 'progressive'
                ? { mode, color: highlight?.color ?? DEFAULT_HIGHLIGHT_COLOR }
                : undefined
            )
          }}
        >
          <option value="off">{t.wordHighlight.off}</option>
          <option value="word">{t.wordHighlight.word}</option>
          <option value="progressive">{t.wordHighlight.progressive}</option>
        </select>
      </div>
      {highlight && (
        <ColorRow
          label={t.wordHighlight.color}
          value={highlight.color}
          onChange={(color) => setHighlight({ ...highlight, color })}
        />
      )}
      <p className="subtitles-panel__hint">{t.wordHighlight.hint}</p>

      <div className="field-row">
        <span className="field-row__label">{t.wordHighlight.chunkSize}</span>
        <input
          type="number"
          min={1}
          max={8}
          value={chunkSize}
          aria-label={t.wordHighlight.chunkSize}
          onChange={(event) => setChunkSize(Number(event.target.value))}
        />
      </div>
      <p className="subtitles-panel__hint">
        {changes ? t.wordHighlight.chunkHint : t.wordHighlight.chunkNothing}
      </p>
      <div className="subtitles-panel__actions">
        <ToolButton
          label={t.wordHighlight.chunk}
          variant="outline"
          disabled={!changes}
          onClick={() =>
            run(
              [{ type: 'subtitle/replace-cues', trackId: track.id, cues: chunked }],
              t.wordHighlight.chunkLabel
            )
          }
        />
      </div>
    </>
  )
}
