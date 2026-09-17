import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { clipEndUs } from '../../../../shared/domain/timeline-track-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { clipSelectSeekUs } from '../../../../shared/domain/clip-select-seek'
import { frameDurationUs, snapMicrosToFrame } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { collectSnapTargets, pxToUs, snapTime, type SnapContext } from './timeline-geometry'
import type { ClipDragMode } from './timeline-clip'
import {
  clipDragCommands,
  clipDragKind,
  clipDragLabel,
  edgePreview,
  ratePreview,
  slipPreview,
  type ClipDragKind,
  type ClipDragPreview
} from './clip-drag-kinds'

export type { ClipDragPreview } from './clip-drag-kinds'

/**
 * Kéo, cắt, slip, rate stretch và blade trên clip bằng chuột.
 *
 * Việc một cú kéo NGHĨA LÀ GÌ nằm ở `clip-drag-kinds` (theo chế độ công cụ và chỗ
 * bấm); ở đây chỉ nghe chuột. Trong lúc kéo chỉ cập nhật trạng thái xem trước cục
 * bộ; document được sửa MỘT lần lúc thả chuột — kéo sinh hàng trăm sự kiện mỗi giây,
 * áp lệnh theo từng sự kiện là nhồi hàng trăm bước vào lịch sử hoàn tác.
 */

const MIN_DRAG_DURATION_US = 1000

/** Di chuột ít hơn chừng này giữa lúc bấm và lúc thả thì coi là bấm chọn, không phải kéo. */
const CLICK_SLOP_PX = 3

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
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const [preview, setPreview] = useState<ClipDragPreview | null>(null)
  const previewRef = useRef<ClipDragPreview | null>(null)

  const handleClipPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, clip: Clip, track: Track, zone: ClipDragMode) => {
      if (!document || track.locked) return
      event.preventDefault()
      event.stopPropagation()

      const { timelineTool, playheadUs } = useEditorStore.getState()
      const additive = event.shiftKey || event.metaKey || event.ctrlKey
      toggleClipSelection(clip.id, track.id, additive)

      // Chỗ bấm quy ra thời gian, tính ngay lúc bấm: clip còn nằm đúng chỗ cũ.
      const clipBox = event.currentTarget.getBoundingClientRect()
      const clickUs = clip.startUs + pxToUs(event.clientX - clipBox.left, pixelsPerSecond)

      const snapContext: SnapContext = {
        document,
        pixelsPerSecond,
        frameRate: document.settings.frameRate,
        // Đọc lúc bấm chứ không theo dõi: theo dõi thì cả timeline vẽ lại mỗi khung
        // khi đang phát.
        playheadUs,
        enabled: snapEnabled,
        excludeClipIds: [clip.id]
      }

      // BLADE: cắt ngay tại chỗ bấm (bắt dính vào đầu phát, mép clip khác nếu gần),
      // làm tròn về khung hình. Không có thao tác kéo.
      if (timelineTool === 'blade') {
        const snapped = snapTime(clickUs, collectSnapTargets(snapContext), snapContext)
        const atUs = snapMicrosToFrame(snapped.us, document.settings.frameRate)
        if (atUs > clip.startUs && atUs < clipEndUs(clip)) {
          run([{ type: 'clip/split', clipId: clip.id, atUs }], 'Cắt clip')
        }
        return
      }

      const kind: ClipDragKind = clipDragKind(timelineTool, zone, track.kind)
      const snapTargets = collectSnapTargets(snapContext)
      const assetDurationUs = document.assets.find((item) => item.id === clip.assetId)?.probe
        .durationUs
      const pointerStartX = event.clientX
      const pointerStartY = event.clientY
      const pointerId = event.pointerId

      const handleMove = (moveEvent: PointerEvent): void => {
        if (moveEvent.pointerId !== pointerId || kind === 'none') return
        const deltaUs = pxToUs(moveEvent.clientX - pointerStartX, pixelsPerSecond)
        const base = {
          clipId: clip.id,
          kind,
          targetTrackId: track.id,
          startUs: clip.startUs,
          durationUs: clip.durationUs,
          snappedToUs: null as number | null
        }
        let next: ClipDragPreview | null = null

        if (kind === 'move') {
          const snapped = snapTime(clip.startUs + deltaUs, snapTargets, snapContext)
          const overTrackId = trackAtClientY(moveEvent.clientY) ?? track.id
          const overTrack = document.tracks.find((item) => item.id === overTrackId)
          // Chỉ cho thả sang track cùng loại và không bị khoá.
          const allowed = overTrack && overTrack.kind === track.kind && !overTrack.locked
          next = {
            ...base,
            targetTrackId: allowed ? overTrackId : track.id,
            startUs: snapped.us,
            snappedToUs: snapped.snappedTo
          }
        } else if (kind === 'slip') {
          next = { ...base, ...slipPreview(clip, deltaUs, assetDurationUs) }
        } else {
          const anchorUs = kind.endsWith('start') ? clip.startUs : clipEndUs(clip)
          const snapped = snapTime(anchorUs + deltaUs, snapTargets, snapContext)
          if (kind === 'rate-start' || kind === 'rate-end') {
            const rate = ratePreview(clip, kind, snapped.us, MIN_DRAG_DURATION_US)
            next = rate ? { ...base, ...rate, snappedToUs: snapped.snappedTo } : previewRef.current
          } else {
            next = {
              ...base,
              ...edgePreview(clip, kind, snapped.us, MIN_DRAG_DURATION_US),
              snappedToUs: snapped.snappedTo
            }
          }
        }

        previewRef.current = next
        setPreview(next)
      }

      const finish = (): void => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        window.removeEventListener('pointercancel', handleCancel)
        previewRef.current = null
        setPreview(null)
      }

      const handleUp = (upEvent: PointerEvent): void => {
        if (upEvent.pointerId !== pointerId) return
        const final = previewRef.current
        finish()
        if (final) {
          const commands = clipDragCommands(clip, track.id, final)
          if (commands.length > 0) run(commands, clipDragLabel(final.kind))
        }

        // Bấm chọn (không kéo, không giữ phím chọn thêm): đưa đầu phát tới clip nếu
        // nó đang ở ngoài, để preview hiện đúng clip vừa chọn.
        const movedPx = Math.max(
          Math.abs(upEvent.clientX - pointerStartX),
          Math.abs(upEvent.clientY - pointerStartY)
        )
        if (movedPx < CLICK_SLOP_PX && !additive) {
          const seekUs = clipSelectSeekUs(
            clip,
            clickUs,
            useEditorStore.getState().playheadUs,
            frameDurationUs(document.settings.frameRate)
          )
          if (seekUs !== null) {
            setPlaying(false)
            setPlayhead(seekUs)
          }
        }
      }

      // Huỷ giữa chừng thì không ghi gì cả — clip trở lại như cũ.
      const handleCancel = (): void => finish()

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      window.addEventListener('pointercancel', handleCancel)
    },
    [
      document,
      pixelsPerSecond,
      snapEnabled,
      toggleClipSelection,
      trackAtClientY,
      run,
      setPlayhead,
      setPlaying
    ]
  )

  return { preview, handleClipPointerDown }
}
