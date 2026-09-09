import { useCallback, useState, type DragEvent } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { MEDIA_DRAG_MIME } from '../ai-studio/media-library-panel'
import { collectSnapTargets, snapTime } from './timeline-geometry'

/** Ảnh không có thời lượng riêng; cho sẵn 5 giây rồi sửa lại bằng cách kéo mép. */
const IMAGE_DEFAULT_DURATION_US = 5_000_000

/**
 * Thả media từ thư viện xuống một track.
 *
 * Từ chối IM LẶNG khi loại không hợp — thả một file nhạc lên track hình chẳng
 * hạn. Đó là chủ ý: người dùng đang kéo qua nhiều track và sẽ thấy track nào
 * sáng lên, nên một hộp thoại báo lỗi ở đây chỉ chắn đường.
 */
export function useTimelineMediaDrop(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
  /** Đổi toạ độ X trên màn hình thành mốc thời gian trên timeline. */
  clientXToUs(clientX: number): number
}): {
  /** Track đang được rê qua, để tô sáng nó. */
  dropTargetTrackId: string | null
  /** Bộ handler kéo-thả gắn thẳng vào một lane. */
  laneDropProps(track: Track): {
    onDragOver(event: DragEvent<HTMLDivElement>): void
    onDragLeave(): void
    onDrop(event: DragEvent<HTMLDivElement>): void
  }
} {
  const { document, pixelsPerSecond, clientXToUs } = options
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null)

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, track: Track) => {
      event.preventDefault()
      setDropTargetTrackId(null)
      if (!document || track.locked) return

      const assetId = event.dataTransfer.getData(MEDIA_DRAG_MIME)
      const asset = document.assets.find((item) => item.id === assetId)
      if (!asset) return

      const durationUsForAsset =
        asset.kind === 'image' ? IMAGE_DEFAULT_DURATION_US : asset.probe.durationUs
      if (durationUsForAsset <= 0) return

      const kindFits =
        (track.kind === 'image' && asset.kind === 'image') ||
        // Lane hình vẫn nhận ảnh như trước: ảnh làm cảnh nền là chuyện thường,
        // và dự án cũ đã đặt ảnh ở đó rồi.
        (track.kind === 'video' && (asset.kind === 'video' || asset.kind === 'image')) ||
        (track.kind === 'audio' && (asset.kind === 'audio' || asset.probe.hasAudio))
      if (!kindFits) return

      const snapContext = {
        document,
        pixelsPerSecond,
        frameRate: document.settings.frameRate,
        playheadUs,
        enabled: snapEnabled
      }
      const dropUs = snapTime(
        clientXToUs(event.clientX),
        collectSnapTargets(snapContext),
        snapContext
      ).us

      const command: EditorCommand = {
        type: 'clip/insert',
        trackId: track.id,
        assetId: asset.id,
        startUs: dropUs,
        durationUs: durationUsForAsset,
        sourceInUs: 0
      }
      run([command], t.media.addToTimeline)
    },
    [document, pixelsPerSecond, playheadUs, snapEnabled, clientXToUs, run, t.media.addToTimeline]
  )

  const laneDropProps = useCallback(
    (track: Track) => ({
      onDragOver: (event: DragEvent<HTMLDivElement>): void => {
        // Chỉ nhận thứ kéo từ thư viện media; kéo chữ hay kéo file lạ vào thì
        // không được biến lane thành vùng thả.
        if (!event.dataTransfer.types.includes(MEDIA_DRAG_MIME)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropTargetTrackId(track.id)
      },
      onDragLeave: (): void => setDropTargetTrackId(null),
      onDrop: (event: DragEvent<HTMLDivElement>): void => handleDrop(event, track)
    }),
    [handleDrop]
  )

  return { dropTargetTrackId, laneDropProps }
}
