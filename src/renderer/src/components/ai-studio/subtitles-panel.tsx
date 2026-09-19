import { useState, type JSX } from 'react'
import { findOverlappingCues } from '../../../../shared/domain/subtitle-cue-builder'
import { interpolate, useT } from '../../i18n/use-translation'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { CollapsibleSection } from '../ui/collapsible-section'
import { EmptyState } from '../ui/empty-state'
import { IconPlus } from '../ui/icons'
import { PanelSubtabs } from '../ui/panel-subtabs'
import { ToolButton } from '../ui/tool-button'
import { SubtitleCreateForm } from './subtitle-create-form'
import { SubtitleImportButton } from './subtitle-import-button'
import { SubtitleCueList } from './subtitle-cue-list'
import { SubtitleStyleControls } from './subtitle-style-controls'
import { SubtitleTrackSettings } from './subtitle-track-settings'
import { SubtitleWordHighlightSection } from './subtitle-word-highlight-section'
import { TextOverlaySection } from './text-overlay-section'
import './subtitles-panel.css'

/**
 * Tab Phụ đề (DESCRIPTION §3.F), chia hai tab con:
 *
 * - Subtitles: chọn track ở đầu (kèm nút tạo mới), rồi các nhóm gập được — Track,
 *   Kiểu chữ, Câu phụ đề. Form tạo chỉ hiện khi chưa có track hoặc khi bấm tạo mới:
 *   trước đây nó luôn chiếm đầu panel dù đã có track.
 * - Text: chữ đè lên hình, dữ liệu riêng, không dính gì tới phụ đề.
 *
 * Phụ đề ở đây là DỮ LIỆU: cùng một track được preview vẽ, được nung khi xuất, và
 * ra file SRT — không có đường dựng chữ riêng nên xem trước và bản xuất không lệch.
 */
export function SubtitlesPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const [tab, setTab] = useState<'subtitles' | 'text'>('subtitles')
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const tracks = document?.subtitleTracks ?? []
  const track = tracks.find((item) => item.id === activeTrackId) ?? tracks[0]
  const overlaps = track ? findOverlappingCues(track.cues) : []

  return (
    <div className="subtitles-panel">
      <PanelSubtabs<'subtitles' | 'text'>
        label={t.studio.tabs.subtitles}
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'subtitles', label: t.subtitles.tabSubtitles },
          { key: 'text', label: t.subtitles.tabText }
        ]}
      />

      {tab === 'text' && <TextOverlaySection />}

      {tab === 'subtitles' && document && (
        <>
          {track && (
            <div className="subtitles-panel__track-bar">
              <select
                value={track.id}
                aria-label={t.subtitles.trackSection}
                onChange={(event) => {
                  setActiveTrackId(event.target.value)
                  setCreating(false)
                }}
              >
                {tracks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {interpolate(t.subtitles.cueCount, { count: item.cues.length })}
                  </option>
                ))}
              </select>
              <ToolButton
                label={t.subtitles.newTrack}
                icon={<IconPlus />}
                variant={creating ? 'outline' : 'ghost'}
                onClick={() => setCreating((value) => !value)}
              />
              <SubtitleImportButton document={document} onImported={setActiveTrackId} />
            </div>
          )}

          {(!track || creating) && (
            <>
              <SubtitleCreateForm
                document={document}
                onCreated={(trackId) => {
                  setActiveTrackId(trackId)
                  setCreating(false)
                }}
              />
              {/*
                Nút nhập phải có mặt CẢ khi chưa có track nào: dự án chưa phiên âm
                thì form tạo chỉ nói "chưa có transcript", và đó đúng là lúc người
                dùng có sẵn file .srt muốn đưa vào.
              */}
              {!track && (
                <div className="subtitles-panel__card">
                  <p className="subtitles-panel__hint">{t.subtitles.importHint}</p>
                  <SubtitleImportButton document={document} onImported={setActiveTrackId} />
                </div>
              )}
            </>
          )}

          {track && (
            <>
              <CollapsibleSection title={t.subtitles.trackSection}>
                <SubtitleTrackSettings document={document} track={track} />
              </CollapsibleSection>

              <CollapsibleSection title={t.subtitles.styleSection}>
                <p className="subtitles-panel__hint">{t.subtitles.styleInInspectorHint}</p>
                <SubtitleStyleControls
                  style={track.style}
                  onChange={(style) =>
                    run(
                      [{ type: 'subtitle/set-style', trackId: track.id, style }],
                      'Đổi kiểu phụ đề'
                    )
                  }
                />
              </CollapsibleSection>

              <CollapsibleSection title={t.wordHighlight.section}>
                <SubtitleWordHighlightSection track={track} />
              </CollapsibleSection>

              <CollapsibleSection
                title={t.subtitles.cuesSection}
                meta={interpolate(t.subtitles.cueCount, { count: track.cues.length })}
                defaultOpen
              >
                {overlaps.length > 0 && (
                  <div className="notice">
                    {interpolate(t.subtitles.overlapWarning, { count: overlaps.length })}
                  </div>
                )}
                <p className="subtitles-panel__hint">{t.subtitles.seekHint}</p>
                <SubtitleCueList track={track} />
              </CollapsibleSection>
            </>
          )}

          {!track && tracks.length === 0 && !document.transcripts.length && (
            <EmptyState title={t.subtitles.noCues} hint={t.subtitles.createHint} />
          )}
        </>
      )}
    </div>
  )
}
