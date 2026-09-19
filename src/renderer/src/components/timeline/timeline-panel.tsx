import { splitClipAt } from '../../state/clip-group-actions'
import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { looseLaneHeight, type Track } from '../../../../shared/domain/timeline-track-types'
import { selectionRemovalCommands } from '../../../../shared/commands/selection-removal'
import { microsToSeconds, snapMicrosToFrame } from '../../../../shared/domain/time-units'
import { selectDocument, selectDurationUs, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { TimelineToolbar } from './timeline-toolbar'
import { useTimelineMediaDrop } from './use-timeline-media-drop'
import { useCutTransitionDrop } from './use-cut-transition-drop'
import { TimelineCutMarkers } from './timeline-cut-markers'
import { TimelineKeyframeStrip } from './timeline-keyframe-strip'
import { useTimelineTracks } from './use-timeline-tracks'
import { useTrackReorder } from './use-track-reorder'
import { useTimelineTextLanes } from './use-timeline-text-lanes'
import { TimelineClip, type ClipDragMode } from './timeline-clip'
import { TimelineRuler } from './timeline-ruler'
import { TimelineMarkerLayer } from './timeline-marker-layer'
import { TimelineTrackHead } from './timeline-track-head'
import { pxToUs, usToPx, zoomToFit } from './timeline-geometry'
import { TimelinePlayhead } from './timeline-playhead'
import { TimelineHoverLine } from './timeline-hover-line'
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
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const timelineTool = useEditorStore((state) => state.timelineTool)
  const setHoverUs = useEditorStore((state) => state.setHoverUs)
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
  const headsRef = useRef<HTMLDivElement>(null)
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
  const { hover: cutHover, laneCutDropProps } = useCutTransitionDrop({
    pixelsPerSecond,
    clientXToUs
  })

  /**
   * Lane nhận HAI loại thả: media (chèn clip) và thẻ chuyển cảnh (vào chỗ nối).
   * Mỗi bên tự kiểm kiểu dữ liệu kéo của mình và bỏ qua kiểu kia, nên gọi lần
   * lượt cả hai là đủ.
   */
  const laneProps = (track: Track): ReturnType<typeof laneDropProps> => {
    const media = laneDropProps(track)
    const cut = laneCutDropProps(track)
    return {
      onDragOver: (event) => {
        cut.onDragOver(event)
        media.onDragOver(event)
      },
      onDragLeave: () => media.onDragLeave(),
      onDrop: (event) => {
        cut.onDrop(event)
        media.onDrop(event)
      }
    }
  }

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

  // Clip nằm trong nhóm còn thành viên khác — để vẽ icon mắt xích.
  const groupedClipIds = useMemo(() => {
    const counts = new Map<string, string[]>()
    for (const track of document?.tracks ?? []) {
      for (const clip of track.clips) {
        if (clip.linkGroupId)
          counts.set(clip.linkGroupId, [...(counts.get(clip.linkGroupId) ?? []), clip.id])
      }
    }
    return new Set([...counts.values()].filter((ids) => ids.length > 1).flat())
  }, [document])

  // Track gốc của clip đang cầm. Chỉ khi track đích KHÁC track này thì cú kéo mới
  // là chuyển track; thành viên nằm ở track khác của một nhóm nhiều track thì vẫn
  // vẽ tại chỗ của nó.
  const dragSourceTrackId = useMemo(
    () =>
      preview
        ? document?.tracks.find((track) => track.clips.some((clip) => clip.id === preview.clipId))
            ?.id
        : undefined,
    [document, preview]
  )
  const dragChangesTrack = preview !== null && preview.targetTrackId !== dragSourceTrackId

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return
    const atUs = useEditorStore.getState().playheadUs
    splitClipAt(selectedClipId, atUs, 'Cắt clip')
  }, [selectedClipId])

  // Nút thùng rác xoá đúng thứ phím Delete xoá — cùng một hàm, nên không thể lệch
  // nhau kiểu nút mờ đi trong khi phím vẫn xoá được.
  const removal = useMemo(() => selectionRemovalCommands(selection), [selection])

  const handleDelete = useCallback(() => {
    if (!removal) return
    run(removal.commands, removal.label)
    clearSelection()
  }, [removal, run, clearSelection])

  /**
   * Bề rộng NHÌN THẤY của vùng lane.
   *
   * Không đo bằng `.timeline__scroll` nữa: từ khi cả hai chiều cùng cuộn ở
   * `.timeline__body`, cột lane rộng đúng bằng nội dung chứ không bằng khung
   * nhìn — đo nó là đo chiều dài timeline, và "Vừa khung" sẽ phóng sai bét.
   */
  const laneViewportWidth = useCallback((): number => {
    const body = bodyRef.current
    if (!body) return 0
    const headsWidth = headsRef.current?.offsetWidth ?? 0
    return Math.max(0, body.clientWidth - headsWidth)
  }, [])

  const handleZoomFit = useCallback(() => {
    setPixelsPerSecond(zoomToFit(durationUs, laneViewportWidth()))
  }, [durationUs, laneViewportWidth, setPixelsPerSecond])

  const { reorder, handleReorderPointerDown } = useTrackReorder({
    document,
    trackRowRefs,
    headsRef
  })

  const { trackHeightPx, heightPreset, setTrackHeight, addTrack } = useTimelineTracks({
    document,
    bodyRef,
    trackRowRefs
  })

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

  return (
    <section
      className={`panel timeline timeline--tool-${timelineTool}`}
      aria-label={t.timeline.title}
    >
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
        <div className="timeline__heads" ref={headsRef}>
          <div className="timeline__heads-spacer" />
          {document.tracks.map((track) => (
            <TimelineTrackHead
              key={track.id}
              track={track}
              dragging={reorder?.trackId === track.id}
              onReorderPointerDown={handleReorderPointerDown}
            />
          ))}

          {/* Vạch chỉ chỗ lane sẽ rơi vào khi thả. */}
          {reorder && (
            <div className="timeline__reorder-line" style={{ top: reorder.indicatorY }} />
          )}
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

        <div className="timeline__scroll">
          <div
            className="timeline__content"
            style={{ width: contentWidthPx }}
            // Vị trí chuột cho khung xem trước nhỏ ở góc preview: làm tròn về khung
            // hình để rê trong cùng một khung không bắn cập nhật thừa.
            onPointerMove={(event) =>
              setHoverUs(
                Math.min(
                  durationUs,
                  snapMicrosToFrame(clientXToUs(event.clientX), document.settings.frameRate)
                )
              )
            }
            onPointerLeave={() => setHoverUs(null)}
          >
            <div className="timeline__ruler-row" onPointerDown={handleScrub}>
              <TimelineRuler
                durationUs={durationUs}
                pixelsPerSecond={pixelsPerSecond}
                widthPx={contentWidthPx}
              />
              <TimelineMarkerLayer markers={document.markers} pixelsPerSecond={pixelsPerSecond} />
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
                  {...laneProps(track)}
                  onDragLeaveCapture={(event) => laneCutDropProps(track).onDragLeave(event)}
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
                    overlaysOnLane(track.id).map((overlay) => (
                      <Fragment key={overlay.id}>
                        {renderOverlayBlock(overlay, track.id)}
                        {selection.text?.kind === 'overlay' &&
                          selection.text.overlayId === overlay.id && (
                            <TimelineKeyframeStrip
                              owner={{
                                target: { kind: 'text', overlayId: overlay.id },
                                startUs: overlay.startUs,
                                durationUs: overlay.endUs - overlay.startUs,
                                keyframes: overlay.keyframes
                              }}
                              pixelsPerSecond={pixelsPerSecond}
                            />
                          )}
                      </Fragment>
                    ))}

                  {track.clips.map((clip) => {
                    const member = preview?.group?.find((item) => item.clipId === clip.id)
                    const isDragging = preview?.clipId === clip.id || member !== undefined
                    const shown =
                      isDragging && preview
                        ? {
                            ...clip,
                            startUs: member?.startUs ?? preview.startUs,
                            durationUs: member?.durationUs ?? preview.durationUs,
                            sourceInUs: preview.sourceInUs ?? clip.sourceInUs,
                            speed: preview.speed ?? clip.speed
                          }
                        : clip
                    // Khi kéo sang track khác, clip chỉ được vẽ ở track đích.
                    if (isDragging && dragChangesTrack && track.id === dragSourceTrackId)
                      return null

                    return (
                      <Fragment key={clip.id}>
                        <TimelineClip
                          clip={shown}
                          track={track}
                          asset={document.assets.find((item) => item.id === clip.assetId)}
                          pixelsPerSecond={pixelsPerSecond}
                          selected={selection.clipIds.includes(clip.id)}
                          grouped={groupedClipIds.has(clip.id)}
                          dragBadge={isDragging ? preview?.badge : undefined}
                          onPointerDown={(event, target, mode: ClipDragMode) =>
                            handleClipPointerDown(event, target, track, mode)
                          }
                        />
                        {/*
                          ANH EM của clip, không phải con: `.timeline-clip` có
                          `contain: paint` nên mọi thứ vẽ bên trong đều bị cắt
                          theo khung clip. Và chỉ hiện cho clip ĐANG CHỌN —
                          hiện cho mọi clip thì timeline thành một rừng chấm.
                        */}
                        {selection.clipIds.includes(clip.id) && (
                          <TimelineKeyframeStrip
                            owner={{
                              target: { kind: 'clip', clipId: clip.id },
                              startUs: shown.startUs,
                              durationUs: shown.durationUs,
                              keyframes: clip.keyframes
                            }}
                            pixelsPerSecond={pixelsPerSecond}
                          />
                        )}
                      </Fragment>
                    )
                  })}

                  {(track.kind === 'video' || track.kind === 'image') && (
                    <TimelineCutMarkers
                      track={track}
                      pixelsPerSecond={pixelsPerSecond}
                      hoverAtUs={cutHover?.trackId === track.id ? cutHover.atUs : null}
                    />
                  )}

                  {/* Clip đang được kéo tới track này nhưng vốn thuộc track khác. */}
                  {preview &&
                    dragChangesTrack &&
                    preview.targetTrackId === track.id &&
                    (preview.group ?? [preview])
                      .filter((item) => !track.clips.some((clip) => clip.id === item.clipId))
                      .map((item) => (
                        <div
                          key={item.clipId}
                          className="timeline-lane__ghost"
                          style={{
                            left: usToPx(item.startUs, pixelsPerSecond),
                            width: usToPx(item.durationUs, pixelsPerSecond)
                          }}
                        />
                      ))}
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

            <TimelineHoverLine pixelsPerSecond={pixelsPerSecond} />
            <TimelinePlayhead
              bodyRef={bodyRef}
              pixelsPerSecond={pixelsPerSecond}
              laneViewportWidth={laneViewportWidth}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
