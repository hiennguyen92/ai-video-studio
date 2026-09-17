import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { clipEndUs } from '../../../../shared/domain/timeline-track-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { useEditorStore } from '../../state/editor-store'
import { collectSnapTargets, pxToUs, snapTime, type SnapContext } from './timeline-geometry'
import type { ClipDragMode } from './timeline-clip'

/**
 * Kéo và cắt clip bằng chuột.
 *
 * Trong lúc kéo chỉ cập nhật một trạng thái xem trước cục bộ; document chỉ được
 * sửa MỘT lần lúc thả chuột. Hai lý do: kéo chuột sinh hàng trăm sự kiện mỗi giây,
 * áp lệnh theo từng sự kiện sẽ nhồi hàng trăm bước vào lịch sử undo và bắt immer
 * dựng lại document liên tục.
 */

export interface ClipDragPreview {
  clipId: string
  mode: ClipDragMode
  /** Track đang được nhắm tới — có thể khác track ban đầu khi kéo dọc. */
  targetTrackId: string
  startUs: number
  durationUs: number
  /** Mốc vừa bắt dính vào, để vẽ đường chỉ dẫn. */
  snappedToUs: number | null
}

interface DragSession {
  clip: Clip
  sourceTrack: Track
  mode: ClipDragMode
  pointerStartX: number
  pointerStartY: number
  pointerId: number
}

const MIN_DRAG_DURATION_US = 1000

export function useTimelineInteractions(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
  /** Trả về id track nằm dưới toạ độ Y hiện tại của con trỏ. */
  trackAtClientY(clientY: number): string | null
}): {
  preview: ClipDragPreview | null
  handleClipPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    clip: Clip,
    track: Track,
    mode: ClipDragMode
  ): void
} {
  const { document, pixelsPerSecond, trackAtClientY } = options
  const run = useEditorStore((state) => state.run)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const toggleClipSelection = useEditorStore((state) => state.toggleClipSelection)

  const [preview, setPreview] = useState<ClipDragPreview | null>(null)
  const sessionRef = useRef<DragSession | null>(null)
  const previewRef = useRef<ClipDragPreview | null>(null)

  const commit = useCallback(
    (session: DragSession, final: ClipDragPreview | null) => {
      if (!final) return

      const commands: EditorCommand[] = []

      if (session.mode === 'move') {
        const movedTrack = final.targetTrackId !== session.sourceTrack.id
        if (movedTrack || final.startUs !== session.clip.startUs) {
          commands.push({
            type: 'clip/move',
            clipId: session.clip.id,
            toTrackId: movedTrack ? final.targetTrackId : undefined,
            toStartUs: final.startUs
          })
        }
      } else if (session.mode === 'trim-start') {
        if (final.startUs !== session.clip.startUs) {
          commands.push({
            type: 'clip/trim',
            clipId: session.clip.id,
            edge: 'start',
            toUs: final.startUs
          })
        }
      } else if (final.startUs + final.durationUs !== clipEndUs(session.clip)) {
        commands.push({
          type: 'clip/trim',
          clipId: session.clip.id,
          edge: 'end',
          toUs: final.startUs + final.durationUs
        })
      }

      if (commands.length > 0) {
        const label = session.mode === 'move' ? 'Di chuyển clip' : 'Cắt clip'
        run(commands, label)
      }
    },
    [run]
  )

  const handleClipPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, clip: Clip, track: Track, mode: ClipDragMode) => {
      if (!document || track.locked) return
      event.preventDefault()
      event.stopPropagation()

      toggleClipSelection(clip.id, track.id, event.shiftKey || event.metaKey || event.ctrlKey)

      const session: DragSession = {
        clip,
        sourceTrack: track,
        mode,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        pointerId: event.pointerId
      }
      sessionRef.current = session

      const snapContext: SnapContext = {
        document,
        pixelsPerSecond,
        frameRate: document.settings.frameRate,
        // Đọc lúc bấm chứ không theo dõi: theo dõi thì cả timeline vẽ lại mỗi khung
        // khi đang phát.
        playheadUs: useEditorStore.getState().playheadUs,
        enabled: snapEnabled,
        excludeClipIds: [clip.id]
      }
      const snapTargets = collectSnapTargets(snapContext)

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== session.pointerId) return
        const deltaUs = pxToUs(moveEvent.clientX - session.pointerStartX, pixelsPerSecond)

        let next: ClipDragPreview

        if (session.mode === 'move') {
          const snapped = snapTime(clip.startUs + deltaUs, snapTargets, snapContext)
          const targetTrackId = trackAtClientY(moveEvent.clientY) ?? session.sourceTrack.id
          const targetTrack = document.tracks.find((item) => item.id === targetTrackId)
          // Chỉ cho thả sang track cùng loại và không bị khoá.
          const allowed =
            targetTrack && targetTrack.kind === session.sourceTrack.kind && !targetTrack.locked
          next = {
            clipId: clip.id,
            mode: session.mode,
            targetTrackId: allowed ? targetTrackId : session.sourceTrack.id,
            startUs: snapped.us,
            durationUs: clip.durationUs,
            snappedToUs: snapped.snappedTo
          }
        } else if (session.mode === 'trim-start') {
          const snapped = snapTime(clip.startUs + deltaUs, snapTargets, snapContext)
          const maxStart = clipEndUs(clip) - MIN_DRAG_DURATION_US
          const startUs = Math.min(snapped.us, maxStart)
          next = {
            clipId: clip.id,
            mode: session.mode,
            targetTrackId: session.sourceTrack.id,
            startUs,
            durationUs: clipEndUs(clip) - startUs,
            snappedToUs: snapped.snappedTo
          }
        } else {
          const snapped = snapTime(clipEndUs(clip) + deltaUs, snapTargets, snapContext)
          const endUs = Math.max(snapped.us, clip.startUs + MIN_DRAG_DURATION_US)
          next = {
            clipId: clip.id,
            mode: session.mode,
            targetTrackId: session.sourceTrack.id,
            startUs: clip.startUs,
            durationUs: endUs - clip.startUs,
            snappedToUs: snapped.snappedTo
          }
        }

        previewRef.current = next
        setPreview(next)
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== session.pointerId) return
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)

        commit(session, previewRef.current)
        sessionRef.current = null
        previewRef.current = null
        setPreview(null)
      }

      const handleCancel = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        // Huỷ giữa chừng thì không ghi gì cả — clip trở lại vị trí cũ.
        sessionRef.current = null
        previewRef.current = null
        setPreview(null)
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [document, pixelsPerSecond, snapEnabled, toggleClipSelection, trackAtClientY, commit]
  )

  return { preview, handleClipPointerDown }
}
