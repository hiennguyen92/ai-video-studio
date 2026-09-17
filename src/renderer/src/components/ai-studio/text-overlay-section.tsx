import { useCallback, useState, type JSX } from 'react'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import { createId } from '../../../../shared/domain/project-document-factory'
import {
  DEFAULT_TEXT_ANIMATION_DURATION_US,
  createDefaultTextOverlayStyle,
  defaultTextTrackId,
  type TextOverlay
} from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { IconPlay, IconSparkle, IconTrash } from '../ui/icons'
import { ToolButton } from '../ui/tool-button'
import { TextOverlayEditor, type TextOverlayEditorTab } from './text-overlay-editor'

/** Giờ ngắn cho tiêu đề thẻ: "1:05.2" thay vì "00:01:05.200" — đủ để nhận ra chữ nào. */
function shortTime(us: number): string {
  const totalTenths = Math.round(us / 100_000)
  const minutes = Math.floor(totalTenths / 600)
  const secondsTenths = totalTenths - minutes * 600
  const secondsText = (secondsTenths / 10).toFixed(1).padStart(4, '0')
  return `${minutes}:${secondsText}`
}

/** Giá trị đặc biệt: người dùng đã chủ động gập hết, đừng tự mở thẻ nào. */
const ALL_COLLAPSED = ''

/**
 * Tab Text: chữ đè lên hình (hook, giá, lời kêu gọi hành động). Dữ liệu RIÊNG với
 * phụ đề: dựng lại phụ đề không được xoá dòng chữ người dùng gõ tay.
 *
 * Danh sách thẻ gọn — giờ, dòng chữ, tua, xoá — và MỘT thẻ mở ra trình chỉnh đầy đủ.
 * Trước đây mọi chữ bày nguyên bộ ô cùng lúc, hai ba chữ là panel dài lê thê. Chữ
 * vừa thêm tự mở; tab con đang xem giữ nguyên khi đổi sang thẻ khác.
 */
export function TextOverlaySection(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const [openId, setOpenId] = useState<string | null>(null)
  const [tab, setTab] = useState<TextOverlayEditorTab>('basic')

  const overlays = document?.textOverlays ?? []
  // Thẻ đang mở đã bị xoá (hoặc chưa mở thẻ nào) thì mở thẻ đầu, trừ khi người
  // dùng vừa tự gập hết.
  const open =
    overlays.find((overlay) => overlay.id === openId) ??
    (openId === ALL_COLLAPSED ? undefined : overlays[0])

  const handleAdd = useCallback(() => {
    // Đọc lúc thao tác, không theo dõi: theo dõi đầu phát là vẽ lại mỗi khung khi đang phát.
    const { playheadUs } = useEditorStore.getState()
    const overlay: TextOverlay = {
      id: createId('text'),
      trackId: defaultTextTrackId(document?.tracks ?? []),
      text: '',
      // Bắt đầu ở đầu phát: người dùng thường tua tới chỗ cần chữ rồi mới thêm.
      startUs: playheadUs,
      endUs: playheadUs + 3_000_000,
      style: createDefaultTextOverlayStyle(),
      animation: 'pop',
      animationDurationUs: DEFAULT_TEXT_ANIMATION_DURATION_US
    }
    if (run([{ type: 'text/add', overlay }], 'Thêm chữ')) {
      setOpenId(overlay.id)
      setTab('basic')
    }
  }, [document, run])

  return (
    <div className="text-overlay-section">
      <p className="subtitles-panel__hint">{t.textOverlay.hint}</p>
      <div className="subtitles-panel__actions">
        <ToolButton
          label={t.textOverlay.add}
          icon={<IconSparkle />}
          variant="primary"
          onClick={handleAdd}
        />
      </div>

      {overlays.length === 0 ? (
        <p className="subtitles-panel__hint">{t.textOverlay.empty}</p>
      ) : (
        <div className="text-overlay-list">
          {overlays.map((overlay, index) => {
            const isOpen = overlay.id === open?.id
            return (
              <article
                key={overlay.id}
                className={`text-overlay-item${isOpen ? ' text-overlay-item--open' : ''}`}
              >
                <div className="text-overlay-item__header">
                  <button
                    type="button"
                    className="text-overlay-item__toggle-button"
                    aria-expanded={isOpen}
                    onClick={() => setOpenId(isOpen ? ALL_COLLAPSED : overlay.id)}
                  >
                    <span className="collapsible__chevron" aria-hidden>
                      ▸
                    </span>
                    <span className="text-overlay-item__summary">
                      <span className="text-overlay-item__preview">
                        {overlay.text.split('\n')[0] || t.textOverlay.emptyText}
                      </span>
                      <span className="text-overlay-item__time">
                        {shortTime(overlay.startUs)} – {shortTime(overlay.endUs)}
                      </span>
                    </span>
                  </button>
                  <ToolButton
                    label={t.textOverlay.seek}
                    icon={<IconPlay />}
                    iconOnly
                    onClick={() => {
                      setPlaying(false)
                      setPlayhead(previewSeekUs(overlay.startUs, overlay.endUs))
                    }}
                  />
                  <ToolButton
                    label={t.textOverlay.remove}
                    icon={<IconTrash />}
                    iconOnly
                    variant="danger"
                    onClick={() => run([{ type: 'text/remove', overlayId: overlay.id }], 'Xoá chữ')}
                  />
                </div>

                {isOpen && (
                  <div className="text-overlay-item__editor">
                    <TextOverlayEditor
                      overlay={overlay}
                      index={index}
                      tab={tab}
                      onTabChange={setTab}
                      sticky={false}
                    />
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
