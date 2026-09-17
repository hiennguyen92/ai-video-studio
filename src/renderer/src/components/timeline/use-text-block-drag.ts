import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  applyTextBlockDrag,
  canDropTextBlock,
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
 *
 * Kéo được cả theo CHIỀU DỌC để đổi lane, đúng như kéo clip: lane đích lấy theo
 * vị trí con trỏ, và chỉ nhận lane cùng loại, không bị khoá.
 */

export interface TextBlockDragPreview {
  id: string
  startUs: number
  endUs: number
  snappedToUs: number | null
  /** Lane sẽ nhận khối này khi thả. Bằng lane cũ khi con trỏ ở chỗ không thả được. */
  targetLaneId: string | null
}

interface DragSession {
  id: string
  target: TextBlockRef
  original: TextBlockRange
  /** Lane khối đang đứng lúc bắt đầu kéo. `null` là lane ảo. */
  sourceLaneId: string | null
  mode: TextBlockDragMode
  pointerStartX: number
  pointerId: number
}

export function useTextBlockDrag(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
  /** Id lane nằm dưới con trỏ, `null` khi con trỏ ở ngoài mọi lane. */
  laneAtClientY(clientY: number): string | null
}): {
  preview: TextBlockDragPreview | null
  handleTextBlockPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    id: string,
    range: TextBlockRange,
    target: TextBlockRef,
    sourceLaneId: string | null,
    mode: TextBlockDragMode
  ): void
} {
  const { document, pixelsPerSecond, laneAtClientY } = options
  const run = useEditorStore((state) => state.run)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)

  const [preview, setPreview] = useState<TextBlockDragPreview | null>(null)
  const previewRef = useRef<TextBlockDragPreview | null>(null)

  const commit = useCallback(
    (session: DragSession, final: TextBlockDragPreview | null) => {
      if (!final || !document) return
      const next = { startUs: final.startUs, endUs: final.endUs }
      const laneChanged = final.targetLaneId !== session.sourceLaneId
      // Không đổi giờ mà cũng không đổi lane thì đừng ghi một bước hoàn tác rỗng.
      if (!laneChanged && !textBlockRangeChanged(session.original, next)) return

      let command: EditorCommand
      if (session.target.kind === 'overlay') {
        command = {
          type: 'text/update',
          overlayId: session.target.overlayId,
          ...next,
          ...(laneChanged && final.targetLaneId ? { trackId: final.targetLaneId } : {})
        }
      } else if (laneChanged && final.targetLaneId) {
        // Lane phụ đề chỉ là chỗ hiển thị; cue thật sự nằm trong SubtitleTrack mà
        // lane đó trỏ tới, nên phải tra ngược ra id của track.
        const lane = document.tracks.find((item) => item.id === final.targetLaneId)
        command = {
          type: 'subtitle/move-cue',
          fromTrackId: session.target.subtitleTrackId,
          toTrackId: lane?.subtitleTrackId ?? session.target.subtitleTrackId,
          cueId: session.target.cueId,
          ...next
        }
      } else {
        command = {
          type: 'subtitle/update-cue',
          trackId: session.target.subtitleTrackId,
          cueId: session.target.cueId,
          ...next
        }
      }

      run(
        [command],
        laneChanged
          ? 'Dời Text sang track khác'
          : session.mode === 'move'
            ? 'Dời chữ'
            : 'Đổi độ dài chữ'
      )
    },
    [document, run]
  )

  const handleTextBlockPointerDown = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      id: string,
      range: TextBlockRange,
      target: TextBlockRef,
      sourceLaneId: string | null,
      mode: TextBlockDragMode
    ) => {
      if (!document) return
      event.preventDefault()
      event.stopPropagation()

      const session: DragSession = {
        id,
        target,
        original: range,
        sourceLaneId,
        mode,
        pointerStartX: event.clientX,
        pointerId: event.pointerId
      }

      const snapContext: SnapContext = {
        document,
        pixelsPerSecond,
        frameRate: document.settings.frameRate,
        // Đọc lúc thao tác, không theo dõi: theo dõi đầu phát là vẽ lại mỗi khung khi đang phát.
        playheadUs: useEditorStore.getState().playheadUs,
        enabled: snapEnabled,
        excludeClipIds: []
      }
      const snapTargets = collectSnapTargets(snapContext)

      // Kéo chuột chỉ mới là ý định; chưa di quá một khoảng thì coi như bấm chọn.
      let moved = false

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== session.pointerId) return
        const deltaPx = moveEvent.clientX - session.pointerStartX
        // Kéo dọc cũng tính là kéo: đổi lane mà không dịch ngang là chuyện thường.
        const laneUnderPointer = laneAtClientY(moveEvent.clientY)
        if (!moved && Math.abs(deltaPx) < 3 && laneUnderPointer === session.sourceLaneId) return
        moved = true

        const deltaUs = pxToUs(deltaPx, pixelsPerSecond)
        // Mốc đang bị kéo: mép phải khi kéo mép phải, còn lại là mép trái.
        const anchorUs = mode === 'trim-end' ? range.endUs : range.startUs
        const snapped = snapTime(anchorUs + deltaUs, snapTargets, snapContext)
        const next = applyTextBlockDrag(range, mode, snapped.us)

        // Cắt mép thì khối ở nguyên lane của nó: kéo mép là đổi độ dài, không
        // phải đổi chỗ.
        const lane =
          mode === 'move' ? document.tracks.find((item) => item.id === laneUnderPointer) : undefined
        const targetLaneId =
          mode === 'move' && canDropTextBlock(target, lane)
            ? (laneUnderPointer as string)
            : session.sourceLaneId

        const nextPreview: TextBlockDragPreview = {
          id,
          startUs: next.startUs,
          endUs: next.endUs,
          snappedToUs: snapped.snappedTo,
          targetLaneId
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
    [commit, document, laneAtClientY, pixelsPerSecond, snapEnabled]
  )

  return { preview, handleTextBlockPointerDown }
}
