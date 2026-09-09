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
import {
  DEFAULT_TRACK_HEIGHT,
  TRACK_HEIGHT_PRESETS,
  looseLaneHeight,
  trackHeightPresetOf,
  type Track,
  type TrackHeightPreset
} from '../../../../shared/domain/timeline-track-types'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import type { SubtitleCue } from '../../../../shared/domain/subtitle-types'
import { selectionRemovalCommands } from '../../../../shared/commands/selection-removal'
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
import { useTextBlockDrag } from './use-text-block-drag'
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
  const selectTextBlock = useEditorStore((state) => state.selectTextBlock)
  const clearSelection = useEditorStore((state) => state.clearSelection)

  /** Bấm vào một khối chữ thì dừng phát và tua tới đầu khối đó. */
  const trackAtClientY = useCallback((clientY: number): string | null => {
    for (const [trackId, element] of trackRowRefs.current) {
      const bounds = element.getBoundingClientRect()
      if (clientY >= bounds.top && clientY <= bounds.bottom) return trackId
    }
    return null
  }, [])

  const { preview: textDrag, handleTextBlockPointerDown } = useTextBlockDrag({
    document,
    pixelsPerSecond,
    laneAtClientY: trackAtClientY
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
  const run = useEditorStore((state) => state.run)

  const lanesRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const trackRowRefs = useRef(new Map<string, HTMLDivElement>())
  const [dropTargetTrackId, setDropTargetTrackId] = useState<string | null>(null)

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

  /**
   * Chữ chưa thuộc lane nào.
   *
   * Dự án dựng trước khi có lane chữ không gán `trackId` cho dòng nào cả, và
   * chúng vẫn phải hiện ra. Lane ảo ở cuối timeline là chỗ của chúng — chỉ hiện
   * khi thật sự còn dòng như vậy, chứ không phải một hàng trống thường trực.
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

  /** Một khối chữ overlay trên timeline. Dùng chung cho lane thật và lane ảo. */
  const renderTextBlock = (overlay: TextOverlay, laneId: string | null): JSX.Element => {
    const shown = shownRange(overlay)
    const block: TextBlockRef = { kind: 'overlay', overlayId: overlay.id }
    return (
      <TimelineTextBlock
        key={overlay.id}
        item={shown}
        variant="overlay"
        pixelsPerSecond={pixelsPerSecond}
        active={playheadUs >= shown.startUs && playheadUs < shown.endUs}
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

  /** Cue phụ đề hiện trên một lane, cũng đã tính khối đang bị kéo sang lane khác. */
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

  /**
   * Cỡ lane đang dùng, đọc từ chính track đầu tiên.
   *
   * Không giữ thành một trường riêng trong dự án: chiều cao vốn đã nằm ở từng
   * track và được lưu sẵn, thêm một chỗ nữa là mở đường cho hai con số lệch nhau.
   */
  const trackHeightPx = document?.tracks[0]?.height ?? DEFAULT_TRACK_HEIGHT
  const heightPreset = trackHeightPresetOf(trackHeightPx)

  const setTrackHeight = useCallback(
    (preset: TrackHeightPreset) => {
      const next = TRACK_HEIGHT_PRESETS.find((item) => item.id === preset)
      if (!document || !next) return
      // Đổi cả loạt trong MỘT lệnh: một lần chọn cỡ là một bước hoàn tác, không
      // phải một bước cho mỗi track.
      run(
        document.tracks.map(
          (track) =>
            ({
              type: 'track/update',
              trackId: track.id,
              patch: { height: next.px }
            }) as EditorCommand
        ),
        t.timeline.trackHeight
      )
    },
    [document, run, t.timeline.trackHeight]
  )

  const addTrack = useCallback(
    (kind: 'video' | 'audio' | 'text') => {
      if (!document) return
      const count = document.tracks.filter((track) => track.kind === kind).length + 1
      const names = { video: `Video ${count}`, audio: `Âm thanh ${count}`, text: `Text ${count}` }
      const labels = {
        video: t.timeline.addVideoTrack,
        audio: t.timeline.addAudioTrack,
        text: t.timeline.addTextTrack
      }
      run(
        [
          {
            type: 'track/add',
            kind,
            name: names[kind],
            role: kind === 'audio' ? 'dialogue' : undefined,
            // Khớp cỡ lane đang chọn, nếu không lane mới cao chênh giữa đám.
            height: trackHeightPx
          }
        ],
        labels[kind]
      )
    },
    [
      document,
      run,
      trackHeightPx,
      t.timeline.addVideoTrack,
      t.timeline.addAudioTrack,
      t.timeline.addTextTrack
    ]
  )

  /**
   * Đưa track vừa thêm vào tầm nhìn.
   *
   * Ở chiều cao mặc định của timeline chỉ vừa khoảng bốn lane, nên track thứ năm
   * trở đi được tạo ra NGOÀI tầm nhìn: bấm "Thêm track" xong màn hình không đổi
   * gì cả và trông y như cái nút không ăn.
   *
   * Cuộn VỪA ĐỦ (`block: 'nearest'`) chứ không nhảy xuống đáy: nhảy đáy thì
   * những lane phía trên biến mất hết, và người dùng mất luôn chỗ dựa để nhận ra
   * có gì vừa thêm.
   *
   * Mốc so sánh phải kèm id dự án. Lần đầu tài liệu về, số track nhảy từ 0 lên N
   * — không phân biệt thì mở một dự án có sẵn năm track cũng bị cuộn, và hai
   * lane đầu rơi khỏi màn hình ngay khi vừa mở.
   */
  const projectIdRef = useRef<string | null>(null)
  const trackCountRef = useRef(0)
  const projectId = document?.id ?? null
  const trackCount = document?.tracks.length ?? 0
  const lastTrackId = document?.tracks.at(-1)?.id
  useLayoutEffect(() => {
    const sameProject = projectIdRef.current === projectId
    const previous = trackCountRef.current
    projectIdRef.current = projectId
    trackCountRef.current = trackCount
    if (!sameProject || trackCount <= previous) return

    // Tự tính rồi cuộn CHÍNH `.timeline__body`, không dùng `scrollIntoView`.
    // `scrollIntoView` cuộn khung cuộn gần nhất, mà khung đó là `.timeline__scroll`
    // — nơi chỉ chứa cột lane, không chứa cột đầu track. Đo được: nó kéo lane đi
    // còn đầu track đứng yên, và hai cột lệch hàng nhau.
    const row = lastTrackId ? trackRowRefs.current.get(lastTrackId) : undefined
    const body = bodyRef.current
    if (!row || !body) return

    const rowRect = row.getBoundingClientRect()
    const frame = body.getBoundingClientRect()
    if (rowRect.bottom > frame.bottom) body.scrollTop += rowRect.bottom - frame.bottom
    else if (rowRect.top < frame.top) body.scrollTop -= frame.top - rowRect.top
  }, [projectId, trackCount, lastTrackId])

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
          label={selection.text ? t.timeline.deleteTextBlock : t.timeline.deleteClip}
          icon={<IconTrash />}
          iconOnly
          onClick={handleDelete}
          disabled={!removal}
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
        <ToolButton
          label={t.timeline.addTextTrack}
          icon={<IconPlus />}
          onClick={() => addTrack('text')}
        />

        <select
          className="timeline__height-select"
          value={heightPreset}
          aria-label={t.timeline.trackHeight}
          title={t.timeline.trackHeight}
          onChange={(event) => setTrackHeight(event.target.value as TrackHeightPreset)}
        >
          <option value="small">{t.timeline.trackHeightSmall}</option>
          <option value="medium">{t.timeline.trackHeightMedium}</option>
          <option value="large">{t.timeline.trackHeightLarge}</option>
        </select>

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
                    cuesOnLane(track).map(({ cue, subtitleTrackId }) => {
                      const shown = shownRange(cue)
                      const block: TextBlockRef = {
                        kind: 'subtitle',
                        subtitleTrackId,
                        cueId: cue.id
                      }
                      return (
                        <TimelineTextBlock
                          key={cue.id}
                          item={shown}
                          variant="subtitle"
                          pixelsPerSecond={pixelsPerSecond}
                          active={playheadUs >= shown.startUs && playheadUs < shown.endUs}
                          selected={
                            selection.text?.kind === 'subtitle' && selection.text.cueId === cue.id
                          }
                          dragging={textDrag?.id === cue.id}
                          onSelect={(item) => chooseBlock(block, item)}
                          onPointerDown={(event, _item, mode) =>
                            handleTextBlockPointerDown(
                              event,
                              cue.id,
                              { startUs: cue.startUs, endUs: cue.endUs },
                              block,
                              track.id,
                              mode
                            )
                          }
                        />
                      )
                    })}

                  {/*
                    Lane chữ: vẽ CHỮ OVERLAY thuộc về nó. Cũng như cue phụ đề,
                    chữ overlay nằm ở cấp tài liệu chứ không nằm trong
                    `track.clips`, nên thiếu nhánh này thì lane luôn trống.
                  */}
                  {track.kind === 'text' &&
                    overlaysOnLane(track.id).map((overlay) => renderTextBlock(overlay, track.id))}

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
                  {overlaysOnLane(null).map((overlay) => renderTextBlock(overlay, null))}
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
