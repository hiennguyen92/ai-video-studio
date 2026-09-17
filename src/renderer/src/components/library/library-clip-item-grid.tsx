import { useState, type DragEvent, type JSX } from 'react'
import {
  acceptsLibraryItem,
  libraryDragMime,
  libraryMotionCommands,
  type LibraryClipItem
} from '../../../../shared/domain/library-clip-effects'
import type { Clip, TrackKind } from '../../../../shared/domain/timeline-track-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { LibraryCardPreview } from './library-card-preview'

/**
 * Lưới thẻ của tab Library: chuyển cảnh hoặc zoom.
 *
 * - Chuyển cảnh: CHỈ kéo, thả vào chỗ nối giữa hai clip trên timeline. Bấm thẻ
 *   không làm gì, vì chuyển cảnh không thuộc về clip đang chọn.
 * - Zoom: bấm thẻ để áp vào clip hình đang chọn, hoặc kéo thẻ thả lên clip.
 */
export function LibraryClipItemGrid({
  items,
  kind
}: {
  items: Array<{ item: LibraryClipItem; label: string }>
  kind: 'transition' | 'motion'
}): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const selectedClipId = useEditorStore((state) => state.selection.clipIds[0])
  const run = useEditorStore((state) => state.run)
  // Thẻ đang được rê chuột hoặc focus: chỉ thẻ đó chạy minh hoạ.
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const selected = kind === 'motion' ? findVisualClip(document?.tracks ?? [], selectedClipId) : null

  const apply = (item: LibraryClipItem): void => {
    if (item.type !== 'motion' || !selected) return
    const planned = libraryMotionCommands(item.kind, selected.clip, selected.trackKind)
    if (planned) run(planned.commands, planned.label)
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, item: LibraryClipItem): void => {
    event.dataTransfer.setData(libraryDragMime(item), JSON.stringify(item))
    event.dataTransfer.effectAllowed = 'copy'
  }

  const hint =
    kind === 'transition'
      ? t.library.transitionsHint
      : selected
        ? t.library.hintSelected
        : t.library.hintNoClip

  return (
    <div className="library-grid-section">
      <p className="library-hint">{hint}</p>

      <div className="library-grid">
        {items.map(({ item, label }) => {
          const current = item.type === 'motion' && selected?.clip.motion?.kind === item.kind
          const key = `${item.type}-${item.kind}`
          return (
            <button
              key={key}
              type="button"
              draggable
              className={`library-card${current ? ' library-card--current' : ''}`}
              aria-pressed={kind === 'motion' ? current : undefined}
              title={label}
              onClick={() => apply(item)}
              onDragStart={(event) => handleDragStart(event, item)}
              onMouseEnter={() => setActiveKey(key)}
              onMouseLeave={() => setActiveKey((value) => (value === key ? null : value))}
              onFocus={() => setActiveKey(key)}
              onBlur={() => setActiveKey((value) => (value === key ? null : value))}
            >
              <LibraryCardPreview item={item} playing={activeKey === key} />
              <span className="library-card__label">{label}</span>
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
