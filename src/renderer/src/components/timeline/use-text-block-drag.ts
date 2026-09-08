import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  applyTextBlockDrag,
  textBlockRangeChanged,
  type TextBlockDragMode,
  type TextBlockRange,
  type TextBlockRef
} from '../../../../shared/domain/text-block-drag'
import { useEditorStore } from '../../state/editor-store'
import { collectSnapTargets, pxToUs, snapTime, type SnapContext } from './timeline-geometry'

/**
 * Kéo khối chữ trên timeline để đổi giờ.
 *
 * Theo đúng lối của kéo clip: trong lúc kéo chỉ giữ một trạng thái xem trước cục
 * bộ, document chỉ được sửa MỘT lần lúc thả. Áp lệnh theo từng sự kiện chuột sẽ
 * nhồi hàng trăm bước vào lịch sử hoàn tác.
 *
 * Phụ đề và chữ overlay dùng chung lối kéo nhưng phát ra HAI lệnh khác nhau — cue
 * phụ đề thuộc về một SubtitleTrack, còn chữ overlay nằm ở cấp tài liệu.
 */

export interface TextBlockDragPreview {
  id: string
  startUs: number
  endUs: number
  snappedToUs: number | null
}

interface DragSession {
  id: string
  target: TextBlockRef
  original: TextBlockRange
  mode: TextBlockDragMode
  pointerStartX: number
  pointerId: number
}

export function useTextBlockDrag(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
}): {
  preview: TextBlockDragPreview | null
  handleTextBlockPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    range: TextBlockRange,
    target: TextBlockRef,
    mode: TextBlockDragMode
  ): void
} {
  const { document, pixelsPerSecond } = options
  const run = useEditorStore((state) => state.run)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const playheadUs = useEditorStore((state) => state.playheadUs)

  const [preview, setPreview] = useState<TextBlockDragPreview | null>(null)
  const previewRef = useRef<TextBlockDragPreview | null>(null)

  const commit = useCallback(
    (session: DragSession, final: TextBlockDragPreview | null) => {
      if (!final) return
      const next = { startUs: final.startUs, endUs: final.endUs }
      if (!textBlockRangeChanged(session.original, next)) return

      const command: EditorCommand =
        session.target.kind === 'overlay'
          ? { type: 'text/update', overlayId: session.target.overlayId, ...next }
          : {
              type: 'subtitle/update-cue',
              trackId: session.target.subtitleTrackId,
              cueId: session.target.cueId,
              ...next
            }

      run([command], session.mode === 'move' ? 'Dời chữ' : 'Đổi độ dài chữ')
    },
    [run]
  )

  const handleTextBlockPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      id: string,
      range: TextBlockRange,
      target: TextBlockRef,
      mode: TextBlockDragMode
    ) => {
      if (!document) return
      event.preventDefault()
      event.stopPropagation()

      const session: DragSession = {
        id,
        target,
        original: range,
        mode,
        pointerStartX: event.clientX,
        pointerId: event.pointerId
      }

      const snapContext: SnapContext = {
        document,
        pixelsPerSecond,
        frameRate: document.settings.frameRate,
        playheadUs,
        enabled: snapEnabled,
        excludeClipIds: []
      }
      const snapTargets = collectSnapTargets(snapContext)

      // Kéo chuột chỉ mới là ý định; chưa di quá một khoảng thì coi như bấm chọn.
      let moved = false

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== session.pointerId) return
        const deltaPx = moveEvent.clientX - session.pointerStartX
        if (!moved && Math.abs(deltaPx) < 3) return
        moved = true

        const deltaUs = pxToUs(deltaPx, pixelsPerSecond)
        // Mốc đang bị kéo: mép phải khi kéo mép phải, còn lại là mép trái.
        const anchorUs = mode === 'trim-end' ? range.endUs : range.startUs
        const snapped = snapTime(anchorUs + deltaUs, snapTargets, snapContext)
        const next = applyTextBlockDrag(range, mode, snapped.us)

        const nextPreview: TextBlockDragPreview = {
          id,
          startUs: next.startUs,
          endUs: next.endUs,
          snappedToUs: snapped.snappedTo
        }
        previewRef.current = nextPreview
        setPreview(nextPreview)
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== session.pointerId) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleUp)

        if (moved) commit(session, previewRef.current)
        previewRef.current = null
        setPreview(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleUp)
    },
    [commit, document, pixelsPerSecond, playheadUs, snapEnabled]
  )

  return { preview, handleTextBlockPointerDown }
}
