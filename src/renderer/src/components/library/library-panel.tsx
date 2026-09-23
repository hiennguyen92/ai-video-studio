import { useState, type JSX } from 'react'
import {
  LIBRARY_MOTION_KINDS,
  LIBRARY_TRANSITION_KINDS
} from '../../../../shared/domain/library-clip-effects'
import { useT } from '../../i18n/use-translation'
import { SoundEffectSection } from '../ai-studio/sound-effect-section'
import { MOTION_LABEL_KEYS, TRANSITION_LABEL_KEYS } from './clip-effect-labels'
import { LibraryClipItemGrid } from './library-clip-item-grid'
import { LibraryEffectGrid } from './library-effect-grid'
import { LibraryLookGrid } from './library-look-grid'
import { LibraryEditStyleGrid } from './library-edit-style-grid'
import './library-panel.css'

type LibrarySubTab = 'transitions' | 'effects' | 'lut' | 'zoom' | 'sound-effects' | 'edit-styles'

/**
 * Tab Library: những thứ dựng sẵn đem áp vào dự án — chuyển cảnh, hiệu ứng, zoom,
 * hiệu ứng âm thanh.
 *
 * Tab con đã mở được GIỮ trong cây, chỉ ẩn đi: Sound Effects đang phát nghe thử
 * mà bị tháo ra là tiếng tắt ngang và danh sách phải nạp lại.
 */
export function LibraryPanel(): JSX.Element {
  const t = useT()
  const [subTab, setSubTab] = useState<LibrarySubTab>('transitions')
  const [visited, setVisited] = useState<Set<LibrarySubTab>>(new Set(['transitions']))

  const select = (tab: LibrarySubTab): void => {
    setSubTab(tab)
    setVisited((current) => (current.has(tab) ? current : new Set(current).add(tab)))
  }

  const tabs: Array<{ key: LibrarySubTab; label: string }> = [
    { key: 'transitions', label: t.library.tabs.transitions },
    { key: 'effects', label: t.library.tabs.effects },
    { key: 'lut', label: t.library.tabs.lut },
    { key: 'zoom', label: t.library.tabs.zoom },
    { key: 'sound-effects', label: t.library.tabs.soundEffects },
    { key: 'edit-styles', label: t.library.editStyles }
  ]

  const section = (key: LibrarySubTab, content: JSX.Element): JSX.Element | null =>
    visited.has(key) ? (
      <div className="library-panel__section" role="tabpanel" hidden={subTab !== key}>
        {content}
      </div>
    ) : null

  return (
    <div className="library-panel">
      {/* Bám mép trên khi cuộn: lưới thẻ dài, cuộn xuống là mất lối đổi tab con. */}
      <div className="library-panel__subtabs">
        <div className="subtab-bar" role="tablist" aria-label={t.studio.tabs.library}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={subTab === tab.key}
              // Panel hẹp thì tên dài bị cắt bằng dấu ba chấm; rê chuột vẫn đọc được.
              title={tab.label}
              className={`subtab ${subTab === tab.key ? 'subtab--active' : ''}`}
              onClick={() => select(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {section(
        'transitions',
        <LibraryClipItemGrid
          kind="transition"
          items={LIBRARY_TRANSITION_KINDS.map((kind) => ({
            item: { type: 'transition', kind },
            label: t.inspector[TRANSITION_LABEL_KEYS[kind]]
          }))}
        />
      )}

      {section('effects', <LibraryEffectGrid />)}

      {section('lut', <LibraryLookGrid />)}

      {section(
        'zoom',
        <LibraryClipItemGrid
          kind="motion"
          items={LIBRARY_MOTION_KINDS.map((kind) => ({
            item: { type: 'motion', kind },
            label: t.inspector[MOTION_LABEL_KEYS[kind]]
          }))}
        />
      )}

      {section('sound-effects', <SoundEffectSection />)}

      {section('edit-styles', <LibraryEditStyleGrid />)}
    </div>
  )
}
