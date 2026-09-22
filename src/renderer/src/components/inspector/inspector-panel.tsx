import { useMemo, useState, type JSX } from 'react'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { ClipInspector } from './clip-inspector'
import type { ClipInspectorTab } from './clip-inspector-tab-list'
import { TextBlockInspector } from './text-block-inspector'
import { AiChatPanel } from '../chat/ai-chat-panel'
import './inspector-panel.css'

/**
 * Panel phải — Thuộc tính và AI Chat (DESCRIPTION §2).
 *
 * Thuộc tính clip nằm ở `ClipInspector` (tab con Basic/Video/Audio/Animation).
 */

/**
 * Tìm clip đang chọn cùng track chứa nó.
 *
 * Để ngoài component và giữ thuần: vòng lặp có `return` sớm nằm trong `useMemo`
 * khiến bộ biên dịch React không tối ưu hoá được khối đó.
 */
function findClipWithTrack(
  document: ProjectDocument | null,
  clipId: string | undefined
): { clip: Clip; track: Track } | null {
  if (!document || !clipId) return null
  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === clipId)
    if (clip) return { clip, track }
  }
  return null
}

export function InspectorPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const selection = useEditorStore((state) => state.selection)
  const run = useEditorStore((state) => state.run)
  const [activeTab, setActiveTab] = useState<'inspector' | 'chat'>('inspector')
  // Chỉ dựng chat khi lần đầu mở, nhưng đã dựng thì giữ nguyên.
  const [visitedChat, setVisitedChat] = useState(false)
  const [clipTab, setClipTab] = useState<ClipInspectorTab>('basic')

  const found = useMemo(
    () => findClipWithTrack(document, selection.clipIds[0]),
    [document, selection.clipIds]
  )

  const asset = found ? document?.assets.find((item) => item.id === found.clip.assetId) : undefined

  return (
    <section className="panel" aria-label={t.inspector.title}>
      <div className="tab-bar" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'inspector'}
          className={`tab ${activeTab === 'inspector' ? 'tab--active' : ''}`}
          onClick={() => setActiveTab('inspector')}
        >
          {t.inspector.title}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'chat'}
          className={`tab ${activeTab === 'chat' ? 'tab--active' : ''}`}
          onClick={() => {
            setActiveTab('chat')
            setVisitedChat(true)
          }}
        >
          {t.inspector.chat}
        </button>
      </div>

      <div className="panel__body">
        {/* Giữ chat trong cây khi chuyển tab, nếu không hội thoại đang soạn sẽ mất. */}
        {visitedChat && (
          <div className="inspector__tab-panel" hidden={activeTab !== 'chat'}>
            <AiChatPanel />
          </div>
        )}

        {/* Khối chữ được ưu tiên: vùng chọn chỉ giữ MỘT trong hai, và người dùng
            vừa bấm vào nó thì đó là thứ họ đang hỏi về. */}
        {activeTab === 'inspector' && selection.text && document && (
          <TextBlockInspector document={document} block={selection.text} />
        )}

        {activeTab === 'inspector' && !selection.text && !found && (
          <EmptyState title={t.inspector.noSelection} hint={t.inspector.noSelectionHint} />
        )}

        {activeTab === 'inspector' && !selection.text && found && document && (
          <ClipInspector
            clip={found.clip}
            track={found.track}
            asset={asset}
            frameRate={document.settings.frameRate}
            tab={clipTab}
            onTabChange={setClipTab}
            run={run}
          />
        )}
      </div>
    </section>
  )
}
