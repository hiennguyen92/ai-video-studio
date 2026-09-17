import { useCallback, type JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { SubtitleCue } from '../../../../shared/domain/subtitle-types'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import { useEditorStore } from '../../state/editor-store'
import { TimelineTextBlock } from './timeline-text-block'
import { useTextBlockDrag, type TextBlockDragPreview } from './use-text-block-drag'

/**
 * Khối chữ trên timeline: chọn, kéo, và quyết định khối nào thuộc lane nào.
 *
 * Gom cả phần DỰNG khối vào đây thay vì trả về dữ liệu rồi để panel tự dựng: mỗi
 * khối cần đúng sáu mảnh trạng thái của hook này — trạng thái kéo, vùng chọn, đầu
 * phát, mức phóng, hàm chọn và hàm bắt chuột. Truyền cả sáu ra ngoài rồi truyền
 * ngược vào từng chỗ dùng là một danh sách tham số dài hơn chính hàm dựng.
 *
 * Phụ đề và chữ overlay dùng chung lối kéo nhưng KHÁC nhau ở chỗ dữ liệu nằm:
 * cue thuộc về một SubtitleTrack, còn chữ overlay nằm ở cấp tài liệu và chỉ trỏ
 * về lane bằng `trackId`.
 */

export interface TimelineTextLanes {
  textDrag: TextBlockDragPreview | null
  /** Chữ overlay hiện trên một lane. `null` là lane ảo ở cuối timeline. */
  overlaysOnLane(laneId: string | null): TextOverlay[]
  /** Cue phụ đề hiện trên một lane phụ đề. */
  cuesOnLane(track: Track): Array<{ cue: SubtitleCue; subtitleTrackId: string }>
  renderOverlayBlock(overlay: TextOverlay, laneId: string | null): JSX.Element
  renderCueBlock(cue: SubtitleCue, subtitleTrackId: string, laneId: string): JSX.Element
}

export function useTimelineTextLanes(options: {
  document: ProjectDocument | null
  pixelsPerSecond: number
  /** Id lane nằm dưới con trỏ — dùng khi kéo khối sang lane khác. */
  laneAtClientY(clientY: number): string | null
}): TimelineTextLanes {
  const { document, pixelsPerSecond, laneAtClientY } = options
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const selection = useEditorStore((state) => state.selection)
  const selectTextBlock = useEditorStore((state) => state.selectTextBlock)

  const { preview: textDrag, handleTextBlockPointerDown } = useTextBlockDrag({
    document,
    pixelsPerSecond,
    laneAtClientY
  })

  /** Trong lúc kéo, vẽ khối theo trạng thái xem trước chứ không theo tài liệu. */
  const shownRange = useCallback(
    <T extends { id: string; startUs: number; endUs: number }>(item: T): T =>
      textDrag && textDrag.id === item.id
        ? { ...item, startUs: textDrag.startUs, endUs: textDrag.endUs }
        : item,
    [textDrag]
  )

  const chooseBlock = useCallback(
    (block: TextBlockRef, item: { startUs: number; endUs: number }) => {
      // Chọn TRƯỚC rồi mới tua: panel thuộc tính phải hiện đúng khối vừa bấm,
      // chứ không phải clip đang chọn từ trước.
      selectTextBlock(block)
      setPlaying(false)
      // Nhích vào trong khối, không dừng ở đúng mốc bắt đầu: khung đầu của hiệu
      // ứng vào có opacity 0, tua tới đó là thấy màn hình trống.
      setPlayhead(previewSeekUs(item.startUs, item.endUs))
    },
    [selectTextBlock, setPlaying, setPlayhead]
  )

  /**
   * Chữ overlay hiện trên MỘT lane, đã tính cả khối đang bị kéo.
   *
   * Khối đang kéo phải biến mất khỏi lane cũ và hiện ở lane đích ngay trong lúc
   * kéo, giống hệt clip. Vẽ ở cả hai chỗ thì trông như đã nhân đôi; chỉ vẽ ở lane
   * cũ thì không thấy mình sắp thả vào đâu.
   */
  const overlaysOnLane = (laneId: string | null): TextOverlay[] =>
    (document?.textOverlays ?? []).filter((overlay) => {
      const home =
        overlay.trackId &&
        document?.tracks.some((track) => track.kind === 'text' && track.id === overlay.trackId)
          ? overlay.trackId
          : null
      if (textDrag?.id === overlay.id) return textDrag.targetLaneId === laneId
      return home === laneId
    })

  const cuesOnLane = (track: Track): Array<{ cue: SubtitleCue; subtitleTrackId: string }> => {
    const rows: Array<{ cue: SubtitleCue; subtitleTrackId: string }> = []
    for (const subtitleTrack of document?.subtitleTracks ?? []) {
      for (const cue of subtitleTrack.cues) {
        const dragging = textDrag?.id === cue.id
        const home = subtitleTrack.id === track.subtitleTrackId
        if (dragging ? textDrag.targetLaneId === track.id : home) {
          rows.push({ cue, subtitleTrackId: subtitleTrack.id })
        }
      }
    }
    return rows
  }

  const renderOverlayBlock = (overlay: TextOverlay, laneId: string | null): JSX.Element => {
    const shown = shownRange(overlay)
    const block: TextBlockRef = { kind: 'overlay', overlayId: overlay.id }
    return (
      <TimelineTextBlock
        key={overlay.id}
        item={shown}
        variant="overlay"
        pixelsPerSecond={pixelsPerSecond}
        selected={selection.text?.kind === 'overlay' && selection.text.overlayId === overlay.id}
        dragging={textDrag?.id === overlay.id}
        onSelect={(item) => chooseBlock(block, item)}
        onPointerDown={(event, _item, mode) =>
          handleTextBlockPointerDown(
            event,
            overlay.id,
            { startUs: overlay.startUs, endUs: overlay.endUs },
            block,
            laneId,
            mode
          )
        }
      />
    )
  }

  const renderCueBlock = (
    cue: SubtitleCue,
    subtitleTrackId: string,
    laneId: string
  ): JSX.Element => {
    const shown = shownRange(cue)
    const block: TextBlockRef = { kind: 'subtitle', subtitleTrackId, cueId: cue.id }
    return (
      <TimelineTextBlock
        key={cue.id}
        item={shown}
        variant="subtitle"
        pixelsPerSecond={pixelsPerSecond}
        selected={selection.text?.kind === 'subtitle' && selection.text.cueId === cue.id}
        dragging={textDrag?.id === cue.id}
        onSelect={(item) => chooseBlock(block, item)}
        onPointerDown={(event, _item, mode) =>
          handleTextBlockPointerDown(
            event,
            cue.id,
            { startUs: cue.startUs, endUs: cue.endUs },
            block,
            laneId,
            mode
          )
        }
      />
    )
  }

  return { textDrag, overlaysOnLane, cuesOnLane, renderOverlayBlock, renderCueBlock }
}
