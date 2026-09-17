import { useState, type DragEvent } from 'react'
import {
  LIBRARY_LOOK_DRAG_MIME,
  LIBRARY_MOTION_DRAG_MIME,
  acceptsLibraryItem,
  libraryLookCommands,
  libraryMotionCommands,
  parseLibraryDragPayload
} from '../../../../shared/domain/library-clip-effects'
import {
  LIBRARY_EFFECT_DRAG_MIME,
  addClipEffectCommands
} from '../../../../shared/domain/clip-effect-commands'
import { createId } from '../../../../shared/domain/project-document-factory'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { useEditorStore } from '../../state/editor-store'

/**
 * Nhận thẻ ZOOM, LUT và EFFECT kéo từ tab Library thả lên một clip trên timeline.
 *
 * Không nhận chuyển cảnh: chuyển cảnh không thuộc về một clip mà thả vào chỗ nối giữa hai clip,
 * và lane đảm nhận việc đó (`use-cut-transition-drop`). Thẻ chuyển cảnh rê qua
 * clip thì hook này bỏ qua để sự kiện đi tiếp lên lane.
 *
 * Chỉ nhận trên clip hình và track không khoá. Clip khác thì KHÔNG gọi
 * `preventDefault`, nên trình duyệt hiện con trỏ "không thả được".
 */
export function useLibraryClipDrop(
  clip: Clip,
  track: Track
): {
  /** Đang có thẻ zoom rê qua clip này, để tô sáng. */
  dropActive: boolean
  dropProps: {
    onDragOver(event: DragEvent<HTMLDivElement>): void
    onDragLeave(): void
    onDrop(event: DragEvent<HTMLDivElement>): void
  }
} {
  const run = useEditorStore((state) => state.run)
  const [dropActive, setDropActive] = useState(false)
  const accepts = acceptsLibraryItem(track.kind) && !track.locked
  const carriesClipItem = (event: DragEvent<HTMLDivElement>): boolean =>
    event.dataTransfer.types.includes(LIBRARY_MOTION_DRAG_MIME) ||
    event.dataTransfer.types.includes(LIBRARY_LOOK_DRAG_MIME) ||
    event.dataTransfer.types.includes(LIBRARY_EFFECT_DRAG_MIME)

  return {
    dropActive,
    dropProps: {
      onDragOver: (event) => {
        if (!accepts || !carriesClipItem(event)) return
        event.preventDefault()
        // Lane bên dưới cũng nghe kéo-thả (media, chuyển cảnh); dừng ở đây để nó
        // không tô sáng thêm chỗ khác.
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'copy'
        if (!dropActive) setDropActive(true)
      },
      onDragLeave: () => setDropActive(false),
      onDrop: (event) => {
        if (!accepts || !carriesClipItem(event)) return
        event.preventDefault()
        event.stopPropagation()
        setDropActive(false)

        // Effect CHỒNG thêm vào clip, không thay effect đang có.
        const effectKind = event.dataTransfer.getData(LIBRARY_EFFECT_DRAG_MIME)
        if (effectKind) {
          const planned = addClipEffectCommands(clip, effectKind, createId('fx'))
          if (planned) run(planned.commands, planned.label)
          return
        }
        const lookId = event.dataTransfer.getData(LIBRARY_LOOK_DRAG_MIME)
        if (lookId) {
          const planned = libraryLookCommands(lookId, clip, track.kind)
          if (planned) run(planned.commands, planned.label)
          return
        }
        const item = parseLibraryDragPayload(event.dataTransfer.getData(LIBRARY_MOTION_DRAG_MIME))
        if (item?.type !== 'motion') return
        const planned = libraryMotionCommands(item.kind, clip, track.kind)
        if (planned) run(planned.commands, planned.label)
      }
    }
  }
}
