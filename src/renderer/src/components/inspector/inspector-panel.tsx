import { useCallback, useMemo, useState, type JSX } from 'react'
import {
  DEFAULT_CLIP_TRANSFORM,
  clipEndUs,
  type Clip,
  type Track
} from '../../../../shared/domain/timeline-track-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { EmptyState } from '../ui/empty-state'
import { ToolButton } from '../ui/tool-button'
import { ClipColorControls } from './clip-color-controls'
import { ClipMotionControls } from './clip-motion-controls'
import { ClipTransitionControls } from './clip-transition-controls'
import { AiChatPanel } from '../chat/ai-chat-panel'
import './inspector-panel.css'

/**
 * Panel phải — Thuộc tính và AI Chat (DESCRIPTION §2).
 *
 * Thanh trượt chỉ ghi lệnh khi người dùng THẢ chuột (`onChange`), còn khi đang
 * kéo thì chỉ đổi hiển thị. Ghi theo từng bước kéo sẽ nhét hàng chục bước vào
 * lịch sử undo cho một lần chỉnh âm lượng.
 */

type ClipUpdatePatch = Extract<EditorCommand, { type: 'clip/update' }>['patch']

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

  const found = useMemo(
    () => findClipWithTrack(document, selection.clipIds[0]),
    [document, selection.clipIds]
  )

  const updateClip = useCallback(
    (patch: ClipUpdatePatch, label: string) => {
      if (!found) return
      run([{ type: 'clip/update', clipId: found.clip.id, patch }], label)
    },
    [found, run]
  )

  const asset = found ? document?.assets.find((item) => item.id === found.clip.assetId) : undefined
  const transform = found?.clip.transform ?? DEFAULT_CLIP_TRANSFORM

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

        {activeTab === 'inspector' && !found && (
          <EmptyState title={t.inspector.noSelection} hint={t.inspector.noSelectionHint} />
        )}

        {activeTab === 'inspector' && found && (
          <div className="inspector">
            <p className="field-group__title">{t.inspector.clip}</p>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.clip}</span>
              <span className="field-row__value inspector__name" title={asset?.name}>
                {asset?.name ?? found.clip.label ?? '—'}
              </span>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.track}</span>
              <span className="field-row__value">{found.track.name}</span>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.start}</span>
              <span className="field-row__value">{formatClockTime(found.clip.startUs)}</span>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.duration}</span>
              <span className="field-row__value">
                {formatClockTime(found.clip.durationUs)}
                {' · '}
                {formatClockTime(clipEndUs(found.clip), false)}
              </span>
            </div>
            <div className="field-row">
              <span className="field-row__label">{t.inspector.sourceIn}</span>
              <span className="field-row__value">{formatClockTime(found.clip.sourceInUs)}</span>
            </div>

            {/* Chuyển cảnh chỉ có nghĩa với clip hình. */}
            {found.track.kind === 'video' && document && (
              <ClipTransitionControls
                clip={found.clip}
                frameRate={document.settings.frameRate}
                onChange={(transition) =>
                  run(
                    [{ type: 'clip/set-transition', clipId: found.clip.id, transition }],
                    'Đổi chuyển cảnh'
                  )
                }
              />
            )}

            {found.track.kind === 'video' && (
              <ClipMotionControls
                clip={found.clip}
                onChange={(motion) =>
                  run(
                    [{ type: 'clip/set-motion', clipId: found.clip.id, motion }],
                    'Đổi chuyển động'
                  )
                }
              />
            )}

            {found.track.kind === 'video' && (
              <ClipColorControls
                clip={found.clip}
                onChange={(grade) =>
                  run(
                    [{ type: 'clip/set-color-grade', clipId: found.clip.id, grade }],
                    'Chỉnh màu clip'
                  )
                }
              />
            )}

            <p className="field-group__title">{t.inspector.volume}</p>
            <SliderRow
              label={t.inspector.volume}
              value={found.clip.volume}
              min={0}
              max={2}
              step={0.01}
              format={(value) => `${Math.round(value * 100)}%`}
              onCommit={(value) => updateClip({ volume: value }, t.inspector.volume)}
            />
            <SliderRow
              label={t.inspector.fadeIn}
              value={found.clip.fadeInUs}
              min={0}
              max={Math.min(found.clip.durationUs, 5_000_000)}
              step={10_000}
              format={(value) => formatClockTime(value)}
              onCommit={(value) => updateClip({ fadeInUs: Math.round(value) }, t.inspector.fadeIn)}
            />
            <SliderRow
              label={t.inspector.fadeOut}
              value={found.clip.fadeOutUs}
              min={0}
              max={Math.min(found.clip.durationUs, 5_000_000)}
              step={10_000}
              format={(value) => formatClockTime(value)}
              onCommit={(value) =>
                updateClip({ fadeOutUs: Math.round(value) }, t.inspector.fadeOut)
              }
            />

            {found.track.kind === 'video' && (
              <>
                <p className="field-group__title">{t.inspector.resetTransform}</p>
                <SliderRow
                  label={t.inspector.opacity}
                  value={transform.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onCommit={(value) =>
                    updateClip({ transform: { ...transform, opacity: value } }, t.inspector.opacity)
                  }
                />
                <SliderRow
                  label={t.inspector.scale}
                  value={transform.scale}
                  min={0.1}
                  max={4}
                  step={0.01}
                  format={(value) => `${value.toFixed(2)}×`}
                  onCommit={(value) =>
                    updateClip({ transform: { ...transform, scale: value } }, t.inspector.scale)
                  }
                />
                <SliderRow
                  label={t.inspector.positionX}
                  value={transform.x}
                  min={-1}
                  max={1}
                  step={0.005}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onCommit={(value) =>
                    updateClip({ transform: { ...transform, x: value } }, t.inspector.positionX)
                  }
                />
                <SliderRow
                  label={t.inspector.positionY}
                  value={transform.y}
                  min={-1}
                  max={1}
                  step={0.005}
                  format={(value) => `${Math.round(value * 100)}%`}
                  onCommit={(value) =>
                    updateClip({ transform: { ...transform, y: value } }, t.inspector.positionY)
                  }
                />
                <div className="inspector__actions">
                  <ToolButton
                    label={t.inspector.resetTransform}
                    variant="outline"
                    onClick={() =>
                      updateClip(
                        { transform: { ...DEFAULT_CLIP_TRANSFORM } },
                        t.inspector.resetTransform
                      )
                    }
                  />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * Thanh trượt kèm số.
 *
 * Giữ giá trị "đang kéo" ở state cục bộ và chỉ gọi `onCommit` khi thả chuột, để
 * mỗi lần chỉnh chỉ tạo đúng một bước hoàn tác.
 */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format(value: number): string
  onCommit(value: number): void
}): JSX.Element {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? value

  return (
    <div className="field-row">
      <span className="field-row__label">{label}</span>
      <div className="inspector__slider">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          aria-label={label}
          onInput={(event) => setDragging(Number(event.currentTarget.value))}
          onChange={(event) => {
            const next = Number(event.currentTarget.value)
            setDragging(null)
            onCommit(next)
          }}
        />
        <span className="field-row__value inspector__slider-value">{format(shown)}</span>
      </div>
    </div>
  )
}
