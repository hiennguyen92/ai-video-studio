import type { DragEvent, JSX } from 'react'
import { CLIP_LOOKS } from '../../../../shared/domain/clip-look-catalog'
import { buildLookFilterSvg, lookFilterId } from '../../../../shared/domain/clip-look-svg'
import {
  LIBRARY_LOOK_DRAG_MIME,
  acceptsLibraryItem,
  libraryLookCommands
} from '../../../../shared/domain/library-clip-effects'
import type { Clip, TrackKind } from '../../../../shared/domain/timeline-track-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useLocale } from '../../i18n/use-translation'

/** Bộ lọc của mọi look ở cường độ 100%, dựng một lần cho mọi lưới. */
const LOOK_FILTER_DEFS = `<defs>${CLIP_LOOKS.map((look) => buildLookFilterSvg(look, 1)).join('')}</defs>`

/**
 * Tab LUT: lưới look màu dựng sẵn.
 *
 * Ảnh minh hoạ là CÙNG cảnh vẽ sẵn với thẻ Transitions và Zoom, áp đúng bộ lọc
 * mà video sẽ dùng: cả thư viện một kiểu minh hoạ, và thẻ không đổi theo dự án.
 *
 * Bấm thẻ để áp vào clip hình đang chọn, hoặc kéo thẻ thả lên clip.
 */
export function LibraryLookGrid(): JSX.Element {
  const { t, locale } = useLocale()
  const document = useEditorStore(selectDocument)
  const selectedClipId = useEditorStore((state) => state.selection.clipIds[0])
  const run = useEditorStore((state) => state.run)

  const selected = findVisualClip(document?.tracks ?? [], selectedClipId)

  const apply = (lookId: string): void => {
    if (!selected) return
    const planned = libraryLookCommands(lookId, selected.clip, selected.trackKind)
    if (planned) run(planned.commands, planned.label)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, lookId: string): void => {
    event.dataTransfer.setData(LIBRARY_LOOK_DRAG_MIME, lookId)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="library-grid-section">
      <svg
        aria-hidden
        width={0}
        height={0}
        style={{ position: 'absolute' }}
        dangerouslySetInnerHTML={{ __html: LOOK_FILTER_DEFS }}
      />

      <p className="library-hint">{selected ? t.library.hintSelected : t.library.hintNoClip}</p>

      <div className="library-grid">
        {CLIP_LOOKS.map((look) => {
          const name = locale === 'en' ? look.nameEn : look.nameVi
          const current = selected?.clip.look?.id === look.id
          const filter = `url(#${lookFilterId(look.id, 1)})`
          return (
            <button
              key={look.id}
              type="button"
              draggable
              className={`library-card${current ? ' library-card--current' : ''}`}
              aria-pressed={current}
              title={name}
              onClick={() => apply(look.id)}
              onDragStart={(event) => handleDragStart(event, look.id)}
            >
              <span className="library-preview" aria-hidden>
                <span
                  className="library-preview__scene library-preview__scene--a"
                  style={{ filter }}
                />
              </span>
              <span className="library-card__label">{name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Clip đang chọn cùng loại track, nếu đó là clip vẽ ra hình. */
function findVisualClip(
  tracks: Array<{ kind: TrackKind; clips: Clip[] }>,
  clipId: string | undefined
): { clip: Clip; trackKind: TrackKind } | null {
  if (!clipId) return null
  for (const track of tracks) {
    if (!acceptsLibraryItem(track.kind)) continue
    const clip = track.clips.find((item) => item.id === clipId)
    if (clip) return { clip, trackKind: track.kind }
  }
  return null
}
