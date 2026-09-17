import { useState, type JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { interpolate, useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { SubtitleLayoutFields } from '../ai-studio/subtitle-layout-fields'
import { SubtitleTextStyleFields } from '../ai-studio/subtitle-text-style-fields'
import { EmptyState } from '../ui/empty-state'
import { PanelSubtabs } from '../ui/panel-subtabs'

type CueTab = 'basic' | 'style' | 'layout'

/**
 * Thuộc tính một câu phụ đề, chia tab con giống panel clip:
 *
 * - Basic: CHÍNH câu này — nội dung, dòng song ngữ, mốc thời gian (chỉ đọc; đổi giờ
 *   bằng cách kéo khối trên timeline).
 * - Style / Layout: kiểu chữ và bố cục của CẢ track. Hai tab này mở đầu bằng dòng nói
 *   rõ phạm vi, để không ai tưởng mình đang chỉnh riêng một câu.
 */
export function SubtitleCueInspector({
  document,
  block
}: {
  document: ProjectDocument
  block: Extract<TextBlockRef, { kind: 'subtitle' }>
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const [tab, setTab] = useState<CueTab>('basic')

  const track = document.subtitleTracks.find((item) => item.id === block.subtitleTrackId)
  const cue = track?.cues.find((item) => item.id === block.cueId)
  if (!track || !cue)
    return (
      <EmptyState title={t.inspector.missingTextBlock} hint={t.inspector.missingTextBlockHint} />
    )

  const updateCue = (patch: { text?: string; textSecondary?: string }): void => {
    run([{ type: 'subtitle/update-cue', trackId: track.id, cueId: cue.id, ...patch }], 'Sửa phụ đề')
  }
  const setStyle = (style: SubtitleStyle): void => {
    run([{ type: 'subtitle/set-style', trackId: track.id, style }], 'Đổi kiểu phụ đề')
  }
  const scope = (
    <p className="inspector__scope">
      {interpolate(t.inspector.styleScope, { track: track.name, count: track.cues.length })}
    </p>
  )

  return (
    <div className="inspector">
      <PanelSubtabs<CueTab>
        label={t.inspector.subtitleCue}
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'basic', label: t.inspector.tabBasic },
          { key: 'style', label: t.inspector.tabStyle },
          { key: 'layout', label: t.inspector.tabLayout }
        ]}
      />

      {tab === 'basic' && (
        <>
          <p className="field-group__title">{t.inspector.subtitleCue}</p>
          <div className="field-row">
            <span className="field-row__label">{t.inspector.track}</span>
            <span className="field-row__value inspector__name" title={track.name}>
              {track.name}
            </span>
          </div>

          <div className="field-row field-row--stacked">
            <span className="field-row__label">
              {t.inspector.textContent}
              {cue.edited && <span className="inspector__badge">{t.inspector.edited}</span>}
            </span>
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

          <p className="field-group__title">{t.inspector.timing}</p>
          <div className="field-row">
            <span className="field-row__label">{t.inspector.start}</span>
            <span className="field-row__value">{formatClockTime(cue.startUs)}</span>
          </div>
          <div className="field-row">
            <span className="field-row__label">{t.inspector.end}</span>
            <span className="field-row__value">{formatClockTime(cue.endUs)}</span>
          </div>
          <div className="field-row">
            <span className="field-row__label">{t.inspector.duration}</span>
            <span className="field-row__value">{formatClockTime(cue.endUs - cue.startUs)}</span>
          </div>
        </>
      )}

      {tab === 'style' && (
        <>
          {scope}
          <SubtitleTextStyleFields style={track.style} onChange={setStyle} />
        </>
      )}

      {tab === 'layout' && (
        <>
          {scope}
          <SubtitleLayoutFields style={track.style} onChange={setStyle} />
        </>
      )}
    </div>
  )
}
