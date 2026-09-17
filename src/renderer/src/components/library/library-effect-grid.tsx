import { useState, type DragEvent, type JSX } from 'react'
import { CLIP_EFFECTS } from '../../../../shared/domain/clip-effect-catalog'
import {
  LIBRARY_EFFECT_DRAG_MIME,
  addClipEffectCommands
} from '../../../../shared/domain/clip-effect-commands'
import { acceptsLibraryItem } from '../../../../shared/domain/library-clip-effects'
import { createId } from '../../../../shared/domain/project-document-factory'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useLocale } from '../../i18n/use-translation'
import { LibraryEffectPreview } from './library-effect-preview'

/**
 * Tab Effects: lưới effect hình.
 *
 * Effect CHỒNG được: bấm thẻ là THÊM vào cuối chồng của clip đang chọn (không
 * thay cái cũ), kéo thẻ thả lên clip cũng vậy. Sửa, gỡ, đổi thứ tự ở Inspector.
 */
export function LibraryEffectGrid(): JSX.Element {
  const { t, locale } = useLocale()
  const document = useEditorStore(selectDocument)
  const selectedClipId = useEditorStore((state) => state.selection.clipIds[0])
  const run = useEditorStore((state) => state.run)
  const [hovered, setHovered] = useState<string | null>(null)

  const selected = (() => {
    if (!selectedClipId) return null
    for (const track of document?.tracks ?? []) {
      if (!acceptsLibraryItem(track.kind)) continue
      const clip = track.clips.find((item) => item.id === selectedClipId)
      if (clip) return clip
    }
    return null
  })()

  const add = (kind: string): void => {
    if (!selected) return
    const planned = addClipEffectCommands(selected, kind, createId('fx'))
    if (planned) run(planned.commands, planned.label)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, kind: string): void => {
    event.dataTransfer.setData(LIBRARY_EFFECT_DRAG_MIME, kind)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="library-grid-section">
      <p className="library-hint">
        {selected ? t.library.effectsHintSelected : t.library.hintNoClip}
      </p>

      <div className="library-grid">
        {CLIP_EFFECTS.map((definition) => {
          const name = locale === 'en' ? definition.nameEn : definition.nameVi
          const count =
            selected?.effects?.filter((effect) => effect.kind === definition.kind).length ?? 0
          return (
            <button
              key={definition.kind}
              type="button"
              draggable
              className={`library-card${count > 0 ? ' library-card--current' : ''}`}
              data-effect-kind={definition.kind}
              title={name}
              onClick={() => add(definition.kind)}
              onDragStart={(event) => handleDragStart(event, definition.kind)}
              onMouseEnter={() => setHovered(definition.kind)}
              onMouseLeave={() =>
                setHovered((current) => (current === definition.kind ? null : current))
              }
            >
              <LibraryEffectPreview definition={definition} animate={hovered === definition.kind} />
              <span className="library-card__label">
                {name}
                {count > 1 ? ` ×${count}` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
