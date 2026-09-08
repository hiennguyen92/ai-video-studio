import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import { microsToSeconds } from '../../../../shared/domain/time-units'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  selectDocument,
  selectDurationUs,
  useEditorStore
} from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconMagnet, IconPlus, IconSplit, IconTrash, IconZoomIn, IconZoomOut } from '../ui/icons'
import { MEDIA_DRAG_MIME } from '../ai-studio/media-library-panel'
import { TimelineTextBlock } from './timeline-text-block'
import { TimelineClip, type ClipDragMode } from './timeline-clip'
import { TimelineRuler } from './timeline-ruler'
import { TimelineTrackHead } from './timeline-track-head'
import { collectSnapTargets, pxToUs, snapTime, usToPx, zoomToFit } from './timeline-geometry'
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
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const toggleSnap = useEditorStore((state) => state.toggleSnap)
  const selection = useEditorStore((state) => state.selection)

  /** Bấm vào một khối chữ thì dừng phát và tua tới đầu khối đó. */
  const seekToBlock = useCallback(
    (item: { startUs: number }) => {
      setPlaying(false)
      setPlayhead(item.startUs)
    },
    [setPlaying, setPlayhead]
  )
  const run = useEditorStore((state) => state.run)

  const lanesRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRowRefs = useRef(new Map<string, HTMLDivElement>())
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null)

  const contentWidthPx = useMemo(() => {
    const seconds = microsToSeconds(durationUs) + TRAILING_PADDING_SECONDS
    return Math.max(600, seconds * pixelsPerSecond)
  }, [durationUs, pixelsPerSecond])

  /** Track nằm dưới toạ độ Y của con trỏ — dùng khi kéo clip sang track khác. */
  const trackAtClientY = useCallback((clientY: number): string | null => {
    for (const [trackId, element] of trackRowRefs.current) {
      const bounds = element.getBoundingClientRect()
      if (clientY >= bounds.top && clientY <= bounds.bottom) return trackId
    }
    return null
  }, [])

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

  const handleScrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      setPlaying(false)
      setPlayhead(clientXToUs(event.clientX))

      const onMove = (moveEvent: PointerEvent): void => setPlayhead(clientXToUs(moveEvent.clientX))
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [clientXToUs, setPlayhead, setPlaying]
  )

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>, track: Track) => {
      event.preventDefault()
      setDropTargetTrackId(null)
      if (!document || track.locked) return

      const assetId = event.dataTransfer.getData(MEDIA_DRAG_MIME)
      const asset = document.assets.find((item) => item.id === assetId)
      if (!asset) return

      // Ảnh không có thời lượng riêng nên mặc định cho 5 giây, sửa lại bằng cách kéo mép.
      const durationUsForAsset = asset.kind === 'image' ? 5_000_000 : asset.probe.durationUs
      if (durationUsForAsset <= 0) return

      const kindFits =
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

  const selectedClipId = selection.clipIds[0]

  const handleSplit = useCallback(() => {
    if (!selectedClipId) return
    run([{ type: 'clip/split', clipId: selectedClipId, atUs: playheadUs }], t.timeline.split)
  }, [selectedClipId, playheadUs, run, t.timeline.split])

  const handleDelete = useCallback(() => {
    if (selection.clipIds.length === 0) return
    run(
      selection.clipIds.map((clipId) => ({ type: 'clip/remove', clipId }) as EditorCommand),
      t.timeline.deleteClip
    )
  }, [selection.clipIds, run, t.timeline.deleteClip])

  const handleZoomFit = useCallback(() => {
    const width = scrollRef.current?.clientWidth ?? 0
    setPixelsPerSecond(zoomToFit(durationUs, width))
  }, [durationUs, setPixelsPerSecond])

  const addTrack = useCallback(
    (kind: 'video' | 'audio') => {
      if (!document) return
      const count = document.tracks.filter((track) => track.kind === kind).length + 1
      run(
        [
          {
            type: 'track/add',
            kind,
            name: kind === 'video' ? `Video ${count}` : `Âm thanh ${count}`,
            role: kind === 'audio' ? 'dialogue' : undefined
          }
        ],
        kind === 'video' ? t.timeline.addVideoTrack : t.timeline.addAudioTrack
      )
    },
    [document, run, t.timeline.addVideoTrack, t.timeline.addAudioTrack]
  )

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
      <div className="timeline__toolbar">
        <ToolButton
          label={t.timeline.split}
          icon={<IconSplit />}
          iconOnly
          onClick={handleSplit}
          disabled={!selectedClipId}
        />
        <ToolButton
          label={t.timeline.deleteClip}
          icon={<IconTrash />}
          iconOnly
          onClick={handleDelete}
          disabled={selection.clipIds.length === 0}
        />

        <div className="top-bar__divider" />

        <ToolButton
          label={snapEnabled ? t.timeline.snapOn : t.timeline.snapOff}
          icon={<IconMagnet />}
          iconOnly
          active={snapEnabled}
          onClick={toggleSnap}
        />

        <div className="top-bar__divider" />

        <ToolButton
          label={t.timeline.addVideoTrack}
          icon={<IconPlus />}
          onClick={() => addTrack('video')}
        />
        <ToolButton
          label={t.timeline.addAudioTrack}
          icon={<IconPlus />}
          onClick={() => addTrack('audio')}
        />

        <div className="top-bar__spacer" />

        <ToolButton
          label={t.timeline.zoomOut}
          icon={<IconZoomOut />}
          iconOnly
          onClick={() => setPixelsPerSecond(pixelsPerSecond / 1.4)}
          disabled={pixelsPerSecond <= MIN_PIXELS_PER_SECOND}
        />
        <ToolButton label={t.timeline.zoomFit} onClick={handleZoomFit} />
        <ToolButton
          label={t.timeline.zoomIn}
          icon={<IconZoomIn />}
          iconOnly
          onClick={() => setPixelsPerSecond(pixelsPerSecond * 1.4)}
          disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}
        />
      </div>

      <div className="timeline__body">
        <div className="timeline__heads">
          <div className="timeline__heads-spacer" />
          {document.tracks.map((track) => (
            <TimelineTrackHead key={track.id} track={track} />
          ))}
          {/* Đầu của lane ảo. Chiều cao phải KHỚP với lane, nếu không mọi hàng
              phía dưới lệch nhau. */}
          {document.textOverlays.length > 0 && (
            <div className="track-head" style={{ height: 44 }}>
              <div className="track-head__title">
                <span className="track-head__name">{t.timeline.textOverlayLane}</span>
                <span className="track-head__count">{document.textOverlays.length}</span>
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
                  className={`timeline-lane ${track.locked ? 'timeline-lane--locked' : ''} ${
                    dropTargetTrackId === track.id ? 'timeline-lane--drop' : ''
                  }`}
                  style={{ height: track.height }}
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(MEDIA_DRAG_MIME)) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'copy'
                    setDropTargetTrackId(track.id)
                  }}
                  onDragLeave={() => setDropTargetTrackId(null)}
                  onDrop={(event) => handleDrop(event, track)}
                >
                  {/*
                    Lane phụ đề vẽ CUE chứ không vẽ clip: cue nằm trong
                    `document.subtitleTracks`, không nằm trong `track.clips`.
                    Thiếu nhánh này thì lane phụ đề luôn là một hàng trống.
                  */}
                  {track.kind === 'subtitle' &&
                    document.subtitleTracks
                      .find((item) => item.id === track.subtitleTrackId)
                      ?.cues.map((cue) => (
                        <TimelineTextBlock
                          key={cue.id}
                          item={cue}
                          variant="subtitle"
                          pixelsPerSecond={pixelsPerSecond}
                          active={playheadUs >= cue.startUs && playheadUs < cue.endUs}
                          onSelect={seekToBlock}
                        />
                      ))}

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
              {document.textOverlays.length > 0 && (
                <div className="timeline-lane timeline-lane--overlay" style={{ height: 44 }}>
                  {document.textOverlays.map((overlay) => (
                    <TimelineTextBlock
                      key={overlay.id}
                      item={overlay}
                      variant="overlay"
                      pixelsPerSecond={pixelsPerSecond}
                      active={playheadUs >= overlay.startUs && playheadUs < overlay.endUs}
                      onSelect={seekToBlock}
                    />
                  ))}
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
