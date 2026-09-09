import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { looseLaneHeight } from '../../../../shared/domain/timeline-track-types'
import { selectionRemovalCommands } from '../../../../shared/commands/selection-removal'
import { microsToSeconds } from '../../../../shared/domain/time-units'
import { selectDocument, selectDurationUs, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { TimelineToolbar } from './timeline-toolbar'
import { useTimelineMediaDrop } from './use-timeline-media-drop'
import { useTimelineTracks } from './use-timeline-tracks'
import { useTimelineTextLanes } from './use-timeline-text-lanes'
import { TimelineClip, type ClipDragMode } from './timeline-clip'
import { TimelineRuler } from './timeline-ruler'
import { TimelineTrackHead } from './timeline-track-head'
import { pxToUs, usToPx, zoomToFit } from './timeline-geometry'
import { useTimelineInteractions } from './use-timeline-interactions'
import './timeline-panel.css'

/**
 * Panel dưới cùng — timeline nhiều track.
 *
 * Cột đầu track và vùng clip cuộn CHUNG theo chiều dọc nhưng chỉ vùng clip cuộn
 * ngang, nên tên track luôn nhìn thấy khi kéo sang phải.
 */

/** Chừa thêm khoảng trống sau clip cuối để còn chỗ kéo thả tiếp. */
const TRAILING_PADDING_SECONDS = 10

export function TimelinePanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const durationUs = useEditorStore(selectDurationUs)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const pixelsPerSecond = useEditorStore((state) => state.pixelsPerSecond)
  const setPixelsPerSecond = useEditorStore((state) => state.setPixelsPerSecond)
  const selection = useEditorStore((state) => state.selection)
  const clearSelection = useEditorStore((state) => state.clearSelection)

  /** Bấm vào một khối chữ thì dừng phát và tua tới đầu khối đó. */
  const trackAtClientY = useCallback((clientY: number): string | null => {
    for (const [trackId, element] of trackRowRefs.current) {
      const bounds = element.getBoundingClientRect()
      if (clientY >= bounds.top && clientY <= bounds.bottom) return trackId
    }
    return null
  }, [])

  const { textDrag, overlaysOnLane, cuesOnLane, renderOverlayBlock, renderCueBlock } =
    useTimelineTextLanes({ document, pixelsPerSecond, laneAtClientY: trackAtClientY })

  const run = useEditorStore((state) => state.run)

  const lanesRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const trackRowRefs = useRef(new Map<string, HTMLDivElement>())

  const contentWidthPx = useMemo(() => {
    const seconds = microsToSeconds(durationUs) + TRAILING_PADDING_SECONDS
    return Math.max(600, seconds * pixelsPerSecond)
  }, [durationUs, pixelsPerSecond])

  /** Track nằm dưới toạ độ Y của con trỏ — dùng khi kéo clip sang track khác. */
  const { preview, handleClipPointerDown } = useTimelineInteractions({
    document,
    pixelsPerSecond,
    trackAtClientY
  })

  const clientXToUs = useCallback(
    (clientX: number): number => {
      const lanes = lanesRef.current
      if (!lanes) return 0
      const bounds = lanes.getBoundingClientRect()
      return Math.max(0, pxToUs(clientX - bounds.left, pixelsPerSecond))
    },
    [pixelsPerSecond]
  )

  const { dropTargetTrackId, laneDropProps } = useTimelineMediaDrop({
    document,
    pixelsPerSecond,
    clientXToUs
  })

  const handleScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setPlaying(false)
      setPlayhead(clientXToUs(event.clientX))

      // Gộp các lần di chuột về MỘT lần cập nhật mỗi khung vẽ.
      //
      // Chuột bắn ra hơn trăm sự kiện mỗi giây, mà mỗi lần cập nhật đầu phát lại
      // kéo theo một lần tua Player và vẽ lại cả cây.
      //
      // Đo thật, kéo tám lượt trên một dự án chín cảnh: chỉ gộp khung mà không có
      // chốt chặn thì sập ở lượt 3; chỉ có chốt chặn mà không gộp thì sập ở lượt
      // 1; có cả hai thì không sập. Hai thứ này chặn hai nguồn áp lực khác nhau,
      // bỏ cái nào cũng không đủ.
      let pendingUs: number | null = null
      let frameHandle = 0

      const flush = (): void => {
        frameHandle = 0
        if (pendingUs !== null) setPlayhead(pendingUs)
        pendingUs = null
      }

      const onMove = (moveEvent: PointerEvent): void => {
        pendingUs = clientXToUs(moveEvent.clientX)
        if (frameHandle === 0) frameHandle = window.requestAnimationFrame(flush)
      }
      const onUp = (): void => {
        if (frameHandle !== 0) window.cancelAnimationFrame(frameHandle)
        // Chốt lại vị trí cuối cùng, nếu không đầu phát dừng lệch một khung.
        flush()
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [clientXToUs, setPlayhead, setPlaying]
  )

  /**
   * Chữ chưa thuộc lane nào — chỗ đứng của chúng là lane ảo ở cuối timeline.
   *
   * Chỉ hiện khi thật sự còn dòng như vậy, chứ không phải một hàng trống thường
   * trực. Đọc từ tài liệu chứ không từ `overlaysOnLane(null)`: trong lúc kéo một
   * dòng ra khỏi lane ảo, hàng vẫn phải giữ nguyên chiều cao để những hàng dưới
   * không nhảy lên.
   */
  const looseOverlays = useMemo(
    () =>
      (document?.textOverlays ?? []).filter(
        (overlay) =>
          !overlay.trackId ||
          !document?.tracks.some((track) => track.kind === 'text' && track.id === overlay.trackId)
      ),
    [document]
  )

  const selectedClipId = selection.clipIds[0]

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return
    run([{ type: 'clip/split', clipId: selectedClipId, atUs: playheadUs }], t.timeline.split)
  }, [selectedClipId, playheadUs, run, t.timeline.split])

  // Nút thùng rác xoá đúng thứ phím Delete xoá — cùng một hàm, nên không thể lệch
  // nhau kiểu nút mờ đi trong khi phím vẫn xoá được.
  const removal = useMemo(() => selectionRemovalCommands(selection), [selection])

  const handleDelete = useCallback(() => {
    if (!removal) return
    run(removal.commands, removal.label)
    clearSelection()
  }, [removal, run, clearSelection])

  const handleZoomFit = useCallback(() => {
    const width = scrollRef.current?.clientWidth ?? 0
    setPixelsPerSecond(zoomToFit(durationUs, width))
  }, [durationUs, setPixelsPerSecond])

  const { trackHeightPx, heightPreset, setTrackHeight, addTrack } = useTimelineTracks({
    document,
    bodyRef,
    trackRowRefs
  })

  // Giữ playhead luôn trong tầm nhìn khi nó chạy ra ngoài vùng cuộn.
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    const playheadX = usToPx(playheadUs, pixelsPerSecond)
    const left = scroll.scrollLeft
    const right = left + scroll.clientWidth
    if (playheadX < left + 40) scroll.scrollLeft = Math.max(0, playheadX - 80)
    else if (playheadX > right - 60) scroll.scrollLeft = playheadX - scroll.clientWidth + 120
  }, [playheadUs, pixelsPerSecond])

  if (!document) {
    return (
      <section className="panel">
        <div className="panel__header">{t.timeline.title}</div>
        <div className="panel__body">
          <EmptyState title={t.app.loading} hint={t.timeline.empty} />
        </div>
      </section>
    )
  }

  const playheadX = usToPx(playheadUs, pixelsPerSecond)

  return (
    <section className="panel timeline" aria-label={t.timeline.title}>
      <TimelineToolbar
        canSplit={Boolean(selectedClipId)}
        canDelete={Boolean(removal)}
        deletesTextBlock={Boolean(selection.text)}
        heightPreset={heightPreset}
        onSplit={handleSplit}
        onDelete={handleDelete}
        onAddTrack={addTrack}
        onTrackHeight={setTrackHeight}
        onZoomFit={handleZoomFit}
      />

      <div className="timeline__body" ref={bodyRef}>
        <div className="timeline__heads">
          <div className="timeline__heads-spacer" />
          {document.tracks.map((track) => (
            <TimelineTrackHead key={track.id} track={track} />
          ))}
          {/* Đầu của lane ảo. Chiều cao phải KHỚP với lane, nếu không mọi hàng
              phía dưới lệch nhau. */}
          {looseOverlays.length > 0 && (
            <div className="track-head" style={{ height: looseLaneHeight(trackHeightPx) }}>
              <div className="track-head__title">
                <span className="track-head__name">{t.timeline.textLane}</span>
                <span className="track-head__count">{looseOverlays.length}</span>
              </div>
            </div>
          )}
        </div>

        <div className="timeline__scroll" ref={scrollRef}>
          <div className="timeline__content" style={{ width: contentWidthPx }}>
            <div className="timeline__ruler-row" onPointerDown={handleScrub}>
              <TimelineRuler
                durationUs={durationUs}
                pixelsPerSecond={pixelsPerSecond}
                widthPx={contentWidthPx}
              />
            </div>

            <div className="timeline__lanes" ref={lanesRef}>
              {document.tracks.map((track) => (
                <div
                  key={track.id}
                  ref={(element) => {
                    if (element) trackRowRefs.current.set(track.id, element)
                    else trackRowRefs.current.delete(track.id)
                  }}
                  // Lane mang luôn LOẠI của nó: lane chữ và lane phụ đề trông
                  // khác lane hình, và có class thì CSS lẫn kiểm thử đều bám vào
                  // được mà không phải đếm thứ tự hàng.
                  className={`timeline-lane timeline-lane--${track.kind} ${
                    track.locked ? 'timeline-lane--locked' : ''
                  } ${
                    dropTargetTrackId === track.id ||
                    (textDrag && textDrag.targetLaneId === track.id)
                      ? 'timeline-lane--drop'
                      : ''
                  }`}
                  style={{ height: track.height }}
                  {...laneDropProps(track)}
                >
                  {/*
                    Lane phụ đề vẽ CUE chứ không vẽ clip: cue nằm trong
                    `document.subtitleTracks`, không nằm trong `track.clips`.
                    Thiếu nhánh này thì lane phụ đề luôn là một hàng trống.
                  */}
                  {track.kind === 'subtitle' &&
                    cuesOnLane(track).map(({ cue, subtitleTrackId }) =>
                      renderCueBlock(cue, subtitleTrackId, track.id)
                    )}

                  {/*
                    Lane chữ: vẽ CHỮ OVERLAY thuộc về nó. Cũng như cue phụ đề,
                    chữ overlay nằm ở cấp tài liệu chứ không nằm trong
                    `track.clips`, nên thiếu nhánh này thì lane luôn trống.
                  */}
                  {track.kind === 'text' &&
                    overlaysOnLane(track.id).map((overlay) =>
                      renderOverlayBlock(overlay, track.id)
                    )}

                  {track.clips.map((clip) => {
                    const isDragging = preview?.clipId === clip.id
                    const shown =
                      isDragging && preview
                        ? { ...clip, startUs: preview.startUs, durationUs: preview.durationUs }
                        : clip
                    // Khi kéo sang track khác, clip chỉ được vẽ ở track đích.
                    if (isDragging && preview && preview.targetTrackId !== track.id) return null

                    return (
                      <TimelineClip
                        key={clip.id}
                        clip={shown}
                        track={track}
                        asset={document.assets.find((item) => item.id === clip.assetId)}
                        pixelsPerSecond={pixelsPerSecond}
                        selected={selection.clipIds.includes(clip.id)}
                        onPointerDown={(event, target, mode: ClipDragMode) =>
                          handleClipPointerDown(event, target, track, mode)
                        }
                      />
                    )
                  })}

                  {/* Clip đang được kéo tới track này nhưng vốn thuộc track khác. */}
                  {preview &&
                    preview.targetTrackId === track.id &&
                    !track.clips.some((clip) => clip.id === preview.clipId) && (
                      <div
                        className="timeline-lane__ghost"
                        style={{
                          left: usToPx(preview.startUs, pixelsPerSecond),
                          width: usToPx(preview.durationUs, pixelsPerSecond)
                        }}
                      />
                    )}
                </div>
              ))}

              {/*
                Lane chữ đè lên hình.
                
                Không dựa trên một Track nào: chữ overlay nằm ở CẤP TÀI LIỆU
                (`document.textOverlays`), không thuộc track nào cả — đúng như
                bản chất của nó, vì nó vẽ trên toàn khung hình chứ không thuộc
                một lớp hình nào. Nên đây là một lane ảo, chỉ hiện khi có chữ.
              */}
              {looseOverlays.length > 0 && (
                <div
                  className="timeline-lane timeline-lane--overlay"
                  style={{ height: looseLaneHeight(trackHeightPx) }}
                >
                  {overlaysOnLane(null).map((overlay) => renderOverlayBlock(overlay, null))}
                </div>
              )}
            </div>

            {preview?.snappedToUs != null && (
              <div
                className="timeline__snap-guide"
                style={{ left: usToPx(preview.snappedToUs, pixelsPerSecond) }}
              />
            )}

            <div className="timeline__playhead" style={{ left: playheadX }}>
              <div className="timeline__playhead-handle" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
