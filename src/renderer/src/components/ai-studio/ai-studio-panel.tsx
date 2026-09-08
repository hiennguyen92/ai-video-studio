import { useCallback, useState, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { useT } from '../../i18n/use-translation'
import { MediaLibraryPanel } from './media-library-panel'
import { AiSettingsPanel } from './ai-settings-panel'
import { VoicePanel } from './voice-panel'
import { MusicPanel } from './music-panel'
import { TranscribePanel } from './transcribe-panel'
import { TranslatePanel } from './translate-panel'
import { SubtitlesPanel } from './subtitles-panel'

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

  /**
   * Tab đã từng mở thì GIỮ NGUYÊN trong cây React, chỉ ẩn đi khi không hoạt động.
   *
   * Tháo hẳn khỏi cây sẽ xoá sạch trạng thái của tab: người dùng gõ kịch bản và
   * tạo giọng đọc ở tab Giọng đọc, ghé qua tab Media xem asset, quay lại thì
   * kịch bản trống và audio vừa tạo biến mất. Chỉ dựng tab khi lần đầu mở, nên
   * tab chưa đụng tới vẫn không tốn công khởi tạo.
   */
  const [visitedTabs, setVisitedTabs] = useState<Set<StudioTabKey>>(new Set(['media']))

  /**
   * Tăng lên mỗi khi khoá API được lưu hoặc xoá.
   *
   * Cần thiết vì tab được giữ nguyên trong cây: panel Giọng đọc đọc trạng thái
   * khoá đúng một lần lúc dựng, nên nếu không có tín hiệu này thì người dùng lưu
   * khoá ở tab Cấu hình AI xong quay lại vẫn thấy "chưa có khoá" cho tới khi mở
   * lại ứng dụng.
   */
  const [credentialsVersion, setCredentialsVersion] = useState(0)

  const selectTab = useCallback((tab: StudioTabKey) => {
    setActiveTab(tab)
    setVisitedTabs((current) => (current.has(tab) ? current : new Set(current).add(tab)))
  }, [])

  // Tab Giọng đọc cần đưa người dùng sang Cấu hình AI khi thiếu khoá.
  const openSettings = useCallback(() => selectTab('settings'), [selectTab])

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
            onClick={() => selectTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="panel__body" role="tabpanel" aria-label={activeLabel}>
        {visitedTabs.has('media') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'media'}>
            <MediaLibraryPanel
              importing={importing}
              onImportClick={onImportClick}
              onAddToTimeline={onAddToTimeline}
            />
          </div>
        )}

        {visitedTabs.has('voice') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'voice'}>
            <VoicePanel onOpenSettings={openSettings} credentialsVersion={credentialsVersion} />
          </div>
        )}

        {visitedTabs.has('music') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'music'}>
            <MusicPanel onOpenSettings={openSettings} credentialsVersion={credentialsVersion} />
          </div>
        )}

        {visitedTabs.has('transcribe') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'transcribe'}>
            <TranscribePanel
              onOpenSettings={openSettings}
              credentialsVersion={credentialsVersion}
            />
          </div>
        )}

        {visitedTabs.has('settings') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'settings'}>
            <AiSettingsPanel
              onCredentialsChanged={() => setCredentialsVersion((current) => current + 1)}
            />
          </div>
        )}

        {visitedTabs.has('translate') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'translate'}>
            <TranslatePanel onOpenSettings={openSettings} />
          </div>
        )}

        {visitedTabs.has('subtitles') && (
          <div className="studio-tab-panel" hidden={activeTab !== 'subtitles'}>
            <SubtitlesPanel />
          </div>
        )}
      </div>
    </section>
  )
}
