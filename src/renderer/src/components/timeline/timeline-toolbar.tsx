import { useState, type JSX } from 'react'
import type { TrackHeightPreset } from '../../../../shared/domain/timeline-track-types'
import {
  MAX_PIXELS_PER_SECOND,
  MIN_PIXELS_PER_SECOND,
  useEditorStore
} from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import {
  groupSelectedClips,
  selectionCanGroup,
  selectionHasGroup,
  ungroupSelectedClips
} from '../../state/clip-group-actions'
import { ToolButton } from '../ui/tool-button'
import {
  IconChapters,
  IconFreeze,
  IconKeyframeCopy,
  IconKeyframePaste,
  IconLink,
  IconMagnet,
  IconMarker,
  IconRippleDelete,
  IconScissors,
  IconSilenceCut,
  IconTrash,
  IconUnlink,
  IconZoomIn,
  IconZoomOut
} from '../ui/icons'
import {
  addMarkerAtPlayhead,
  currentChapterList,
  rippleDeleteSelection
} from '../../state/timeline-marker-actions'
import { TimelineToolButtons } from './timeline-tool-buttons'
import { AddTrackMenuButton } from './add-track-menu-button'
import { SilenceCutDialog } from './silence-cut-dialog'
import { freezeFrameAtPlayhead } from '../../state/freeze-frame-actions'
import type { AddableTrackKind } from './use-timeline-tracks'

/**
 * Thanh công cụ của timeline.
 *
 * Mức phóng và bắt dính đọc thẳng từ store vì chúng không thuộc về ai khác; còn
 * cắt, xoá, thêm track và cỡ lane thì nhận từ ngoài — chúng cần đúng thứ panel
 * đang giữ (clip đang chọn, khung cuộn, danh sách track).
 */

export function TimelineToolbar({
  canSplit,
  canDelete,
  deletesTextBlock,
  heightPreset,
  onSplit,
  onDelete,
  onAddTrack,
  onTrackHeight,
  onZoomFit
}: {
  canSplit: boolean
  canDelete: boolean
  /** Đang chọn khối chữ chứ không phải clip — nhãn nút xoá đổi theo. */
  deletesTextBlock: boolean
  heightPreset: TrackHeightPreset
  onSplit(): void
  onDelete(): void
  onAddTrack(kind: AddableTrackKind): void
  onTrackHeight(preset: TrackHeightPreset): void
  onZoomFit(): void
}): JSX.Element {
  const t = useT()
  const pixelsPerSecond = useEditorStore((state) => state.pixelsPerSecond)
  const setPixelsPerSecond = useEditorStore((state) => state.setPixelsPerSecond)
  const snapEnabled = useEditorStore((state) => state.snapEnabled)
  const toggleSnap = useEditorStore((state) => state.toggleSnap)
  // Selector trả BOOLEAN: thanh công cụ không được vẽ lại theo từng thay đổi
  // của tài liệu khi đang phát.
  const hasClipboard = useEditorStore((state) => state.keyframeClipboard !== null)
  const hasSelection = useEditorStore(
    (state) => state.selection.clipIds.length > 0 || state.selection.text !== undefined
  )
  const hasClipSelection = useEditorStore((state) => state.selection.clipIds.length > 0)
  const hasMarkers = useEditorStore((state) => (state.session?.document.markers.length ?? 0) > 0)
  const [chaptersCopied, setChaptersCopied] = useState(false)
  const [silenceOpen, setSilenceOpen] = useState(false)
  const [freezing, setFreezing] = useState(false)
  const canGroup = useEditorStore(selectionCanGroup)
  const hasGroup = useEditorStore(selectionHasGroup)

  return (
    <div className="timeline__toolbar">
      <TimelineToolButtons />

      <div className="top-bar__divider" />

      <ToolButton
        label={t.timeline.split}
        icon={<IconScissors />}
        iconOnly
        onClick={onSplit}
        disabled={!canSplit}
      />
      <ToolButton
        label={deletesTextBlock ? t.timeline.deleteTextBlock : t.timeline.deleteClip}
        icon={<IconTrash />}
        iconOnly
        onClick={onDelete}
        disabled={!canDelete}
      />
      <ToolButton
        label={t.timeline.rippleDelete}
        icon={<IconRippleDelete />}
        iconOnly
        onClick={() => rippleDeleteSelection(t.timeline.rippleDelete)}
        disabled={!hasClipSelection}
      />
      <ToolButton
        label={freezing ? t.timeline.freezeWorking : t.timeline.freezeFrame}
        icon={<IconFreeze />}
        iconOnly
        disabled={!hasClipSelection || freezing}
        onClick={() => {
          setFreezing(true)
          void freezeFrameAtPlayhead(t.timeline.freezeFrame).then((result) => {
            setFreezing(false)
            if (!result.ok) useEditorStore.getState().setError(result.error)
          })
        }}
      />
      <ToolButton
        label={t.silenceCut.open}
        icon={<IconSilenceCut />}
        iconOnly
        onClick={() => setSilenceOpen(true)}
        disabled={!hasClipSelection}
      />
      {silenceOpen && <SilenceCutDialog onClose={() => setSilenceOpen(false)} />}

      <div className="top-bar__divider" />

      <ToolButton
        label={t.timeline.markerAdd}
        icon={<IconMarker />}
        iconOnly
        onClick={() => addMarkerAtPlayhead(t.timeline.markerAdd)}
      />
      <ToolButton
        label={chaptersCopied ? t.timeline.markerChaptersCopied : t.timeline.markerChapters}
        icon={<IconChapters />}
        iconOnly
        disabled={!hasMarkers}
        onClick={() => {
          const text = currentChapterList(t.timeline.markerChaptersIntro, (index) =>
            interpolate(t.timeline.markerChapterUntitled, { index })
          )
          if (!text) return
          navigator.clipboard.writeText(text).then(
            () => {
              setChaptersCopied(true)
              window.setTimeout(() => setChaptersCopied(false), 1500)
            },
            // Nói ra thay vì im lặng: nút bấm xong không có gì xảy ra là thứ khó
            // hiểu nhất.
            () => useEditorStore.getState().setError(t.timeline.markerChaptersFailed)
          )
        }}
      />

      <div className="top-bar__divider" />

      <ToolButton
        label={t.timeline.groupClips}
        icon={<IconLink />}
        iconOnly
        onClick={() => groupSelectedClips(t.timeline.groupClips)}
        disabled={!canGroup}
      />
      <ToolButton
        label={t.timeline.ungroupClips}
        icon={<IconUnlink />}
        iconOnly
        onClick={() => ungroupSelectedClips(t.timeline.ungroupClips)}
        disabled={!hasGroup}
      />

      <div className="top-bar__divider" />

      <ToolButton
        label={t.timeline.keyframeCopy}
        icon={<IconKeyframeCopy />}
        iconOnly
        onClick={() => useEditorStore.getState().copyKeyframes()}
        disabled={!hasSelection}
      />
      <ToolButton
        label={t.timeline.keyframePaste}
        icon={<IconKeyframePaste />}
        iconOnly
        onClick={() => useEditorStore.getState().pasteKeyframes(t.timeline.keyframePaste)}
        disabled={!hasClipboard || !hasSelection}
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

      <AddTrackMenuButton onAddTrack={onAddTrack} />

      <select
        className="timeline__height-select"
        value={heightPreset}
        aria-label={t.timeline.trackHeight}
        title={t.timeline.trackHeight}
        onChange={(event) => onTrackHeight(event.target.value as TrackHeightPreset)}
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
      <ToolButton label={t.timeline.zoomFit} onClick={onZoomFit} />
      <ToolButton
        label={t.timeline.zoomIn}
        icon={<IconZoomIn />}
        iconOnly
        onClick={() => setPixelsPerSecond(pixelsPerSecond * 1.4)}
        disabled={pixelsPerSecond >= MAX_PIXELS_PER_SECOND}
      />
    </div>
  )
}
