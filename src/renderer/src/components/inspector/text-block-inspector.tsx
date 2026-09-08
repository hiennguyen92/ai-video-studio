import type { JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { SubtitleStyleControls } from '../ai-studio/subtitle-style-controls'
import { TextOverlayStyleFields } from '../ai-studio/text-overlay-style-fields'

/**
 * Panel thuộc tính cho một KHỐI CHỮ đang chọn trên timeline.
 *
 * Bấm vào một câu phụ đề hay một dòng chữ đè hình trước đây chỉ tua đầu phát tới
 * đó; muốn sửa thì phải sang tab Phụ đề rồi dò trong danh sách. Ở đây hiện đúng
 * những hàng mà clip vẫn hiện — tên, mốc bắt đầu, thời lượng — kèm chính bộ ô
 * chỉnh kiểu của loại chữ đó.
 *
 * Mốc thời gian để CHỈ ĐỌC, giống hệt clip: đổi giờ bằng cách kéo khối trên
 * timeline. Bày thêm một đường sửa giờ thứ hai ở đây thì hai chỗ dễ lệch nhau.
 */

function TimingRows({ startUs, endUs }: { startUs: number; endUs: number }): JSX.Element {
  const t = useT()
  return (
    <>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.start}</span>
        <span className="field-row__value">{formatClockTime(startUs)}</span>
      </div>
      <div className="field-row">
        <span className="field-row__label">{t.inspector.duration}</span>
        <span className="field-row__value">
          {formatClockTime(endUs - startUs)}
          {' · '}
          {formatClockTime(endUs, false)}
        </span>
      </div>
    </>
  )
}

function OverlayInspector({ overlay }: { overlay: TextOverlay }): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)

  return (
    <div className="inspector">
      <p className="field-group__title">{t.inspector.textOverlay}</p>

      <div className="field-row field-row--stacked">
        <span className="field-row__label">{t.inspector.textContent}</span>
        <textarea
          className="inspector__textarea"
          value={overlay.text}
          rows={2}
          aria-label={t.inspector.textContent}
          onChange={(event) =>
            run(
              [{ type: 'text/update', overlayId: overlay.id, text: event.target.value }],
              'Sửa chữ'
            )
          }
        />
      </div>

      <TimingRows startUs={overlay.startUs} endUs={overlay.endUs} />

      <TextOverlayStyleFields overlay={overlay} />
    </div>
  )
}

function CueInspector({
  document,
  block
}: {
  document: ProjectDocument
  block: Extract<TextBlockRef, { kind: 'subtitle' }>
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)

  const track = document.subtitleTracks.find((item) => item.id === block.subtitleTrackId)
  const cue = track?.cues.find((item) => item.id === block.cueId)
  if (!track || !cue)
    return (
      <EmptyState title={t.inspector.missingTextBlock} hint={t.inspector.missingTextBlockHint} />
    )

  const updateCue = (patch: { text?: string; textSecondary?: string }): void => {
    run([{ type: 'subtitle/update-cue', trackId: track.id, cueId: cue.id, ...patch }], 'Sửa phụ đề')
  }

  return (
    <div className="inspector">
      <p className="field-group__title">{t.inspector.subtitleCue}</p>

      <div className="field-row">
        <span className="field-row__label">{t.inspector.track}</span>
        <span className="field-row__value inspector__name" title={track.name}>
          {track.name}
        </span>
      </div>

      <div className="field-row field-row--stacked">
        <span className="field-row__label">{t.inspector.textContent}</span>
        <textarea
          className="inspector__textarea"
          value={cue.text}
          rows={2}
          aria-label={t.inspector.textContent}
          onChange={(event) => updateCue({ text: event.target.value })}
        />
      </div>

      {/* Dòng thứ hai chỉ có ở phụ đề song ngữ; không có thì không bày ô trống. */}
      {cue.textSecondary !== undefined && (
        <div className="field-row field-row--stacked">
          <span className="field-row__label">{t.inspector.secondaryLine}</span>
          <textarea
            className="inspector__textarea"
            value={cue.textSecondary}
            rows={1}
            aria-label={t.inspector.secondaryLine}
            onChange={(event) => updateCue({ textSecondary: event.target.value })}
          />
        </div>
      )}

      <TimingRows startUs={cue.startUs} endUs={cue.endUs} />

      {cue.edited && (
        <div className="field-row">
          <span className="field-row__label">{t.inspector.edited}</span>
          <span className="field-row__value">✓</span>
        </div>
      )}

      {/* Nói thẳng phạm vi: kiểu chữ là của track, sửa ở đây là cả track đổi. */}
      <p className="inspector__hint">{t.inspector.trackStyleNote}</p>
      <SubtitleStyleControls
        style={track.style}
        onChange={(style: SubtitleStyle) =>
          run([{ type: 'subtitle/set-style', trackId: track.id, style }], 'Đổi kiểu phụ đề')
        }
      />
    </div>
  )
}

export function TextBlockInspector({
  document,
  block
}: {
  document: ProjectDocument
  block: TextBlockRef
}): JSX.Element {
  const t = useT()

  if (block.kind === 'subtitle') return <CueInspector document={document} block={block} />

  const overlay = document.textOverlays.find((item) => item.id === block.overlayId)
  // Khối bị xoá trong lúc vẫn đang chọn: nói ra thay vì hiện một panel rỗng.
  if (!overlay)
    return (
      <EmptyState title={t.inspector.missingTextBlock} hint={t.inspector.missingTextBlockHint} />
    )
  return <OverlayInspector overlay={overlay} />
}
