import { useCallback, useState, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { MediaLibraryPanel } from './media-library-panel'
import { AiSettingsPanel } from './ai-settings-panel'
import { VoicePanel } from './voice-panel'
import { MusicPanel } from './music-panel'

/**
 * Panel trái — AI Studio (DESCRIPTION §3).
 *
 * Các tab chưa triển khai vẫn hiện ra và nói rõ chúng chưa có, thay vì bị giấu đi:
 * người dùng cần thấy phạm vi công cụ dự kiến, và một tab biến mất khó hiểu hơn
 * một tab nói thẳng là chưa tới lượt. Không tab nào giả vờ hoạt động.
 */

export type StudioTabKey =
  'media' | 'voice' | 'music' | 'transcribe' | 'translate' | 'subtitles' | 'settings'

export function AiStudioPanel({
  importing,
  onImportClick,
  onAddToTimeline
}: {
  importing: boolean
  onImportClick(): void
  onAddToTimeline(asset: MediaAsset): void
}): JSX.Element {
  const t = useT()
  const [activeTab, setActiveTab] = useState<StudioTabKey>('media')

  // Tab Giọng đọc cần đưa người dùng sang Cấu hình AI khi thiếu khoá.
  const openSettings = useCallback(() => setActiveTab('settings'), [])

  const tabs: Array<{ key: StudioTabKey; label: string }> = [
    { key: 'media', label: t.studio.tabs.media },
    { key: 'voice', label: t.studio.tabs.voice },
    { key: 'music', label: t.studio.tabs.music },
    { key: 'transcribe', label: t.studio.tabs.transcribe },
    { key: 'translate', label: t.studio.tabs.translate },
    { key: 'subtitles', label: t.studio.tabs.subtitles },
    { key: 'settings', label: t.studio.tabs.settings }
  ]

  const activeLabel = tabs.find((tab) => tab.key === activeTab)?.label ?? ''

  return (
    <section className="panel" aria-label={t.studio.title}>
      <div className="panel__header">{t.studio.title}</div>

      <div className="tab-bar" role="tablist" aria-label={t.studio.title}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`tab ${activeTab === tab.key ? 'tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="panel__body" role="tabpanel" aria-label={activeLabel}>
        {activeTab === 'media' && (
          <MediaLibraryPanel
            importing={importing}
            onImportClick={onImportClick}
            onAddToTimeline={onAddToTimeline}
          />
        )}

        {activeTab === 'voice' && <VoicePanel onOpenSettings={openSettings} />}
        {activeTab === 'music' && <MusicPanel />}
        {activeTab === 'settings' && <AiSettingsPanel />}

        {(activeTab === 'transcribe' || activeTab === 'translate' || activeTab === 'subtitles') && (
          <EmptyState title={t.studio.comingSoon} hint={t.studio.comingSoonHint} />
        )}
      </div>
    </section>
  )
}
