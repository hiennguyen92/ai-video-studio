import { useCallback, type JSX } from 'react'
import {
  DEFAULT_TEXT_ANIMATION_DURATION_US,
  createDefaultTextOverlayStyle,
  defaultTextTrackId,
  type TextOverlay
} from '../../../../shared/domain/text-overlay-types'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import { createId } from '../../../../shared/domain/project-document-factory'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { TextOverlayStyleFields } from './text-overlay-style-fields'
import { ToolButton } from '../ui/tool-button'
import { IconSparkle, IconTrash } from '../ui/icons'

/**
 * Chữ đè lên hình: hook, giá, lời kêu gọi hành động.
 *
 * Nằm trong tab Phụ đề vì cùng là chữ trên hình, nhưng là DỮ LIỆU RIÊNG: dựng lại
 * phụ đề từ bản dịch không được xoá mất dòng CTA người dùng gõ tay.
 *
 * Các ô chỉnh kiểu nằm ở `TextOverlayStyleFields` vì panel thuộc tính cũng hiện
 * đúng bộ ô đó khi bấm vào khối chữ trên timeline.
 */

const seconds = (us: number): number => Number((us / 1_000_000).toFixed(2))

export function TextOverlaySection(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const overlays = document?.textOverlays ?? []

  const handleAdd = useCallback(() => {
    // Đọc lúc thao tác, không theo dõi: theo dõi đầu phát là vẽ lại mỗi khung khi đang phát.
    const { playheadUs } = useEditorStore.getState()
    const overlay: TextOverlay = {
      id: createId('text'),
      // Rơi vào lane chữ vừa thêm, nếu có.
      trackId: defaultTextTrackId(document?.tracks ?? []),
      text: '',
      // Bắt đầu ở đầu phát hiện tại: người dùng thường tua tới chỗ cần chữ rồi mới thêm.
      startUs: playheadUs,
      endUs: playheadUs + 3_000_000,
      style: createDefaultTextOverlayStyle(),
      animation: 'pop',
      animationDurationUs: DEFAULT_TEXT_ANIMATION_DURATION_US
    }
    run([{ type: 'text/add', overlay }], 'Thêm chữ')
  }, [document, run])

  return (
    <div className="text-overlay-section">
      <p className="field-group__title">{t.textOverlay.section}</p>
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
          {overlays.map((overlay, index) => (
            <article key={overlay.id} className="text-overlay-item">
              <textarea
                className="text-overlay-item__text"
                value={overlay.text}
                rows={2}
                placeholder={t.textOverlay.textPlaceholder}
                aria-label={`${t.textOverlay.text} ${index + 1}`}
                onChange={(event) =>
                  run(
                    [{ type: 'text/update', overlayId: overlay.id, text: event.target.value }],
                    'Sửa chữ'
                  )
                }
              />

              <div className="text-overlay-item__row">
                <label>
                  <span className="field-row__label">{t.textOverlay.start}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={seconds(overlay.startUs)}
                    aria-label={`${t.textOverlay.start} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/update',
                            overlayId: overlay.id,
                            startUs: Math.max(0, Math.round(Number(event.target.value) * 1_000_000))
                          }
                        ],
                        'Đổi giờ chữ'
                      )
                    }
                  />
                </label>

                <label>
                  <span className="field-row__label">{t.textOverlay.end}</span>
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={seconds(overlay.endUs)}
                    aria-label={`${t.textOverlay.end} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/update',
                            overlayId: overlay.id,
                            endUs: Math.max(0, Math.round(Number(event.target.value) * 1_000_000))
                          }
                        ],
                        'Đổi giờ chữ'
                      )
                    }
                  />
                </label>
              </div>

              <TextOverlayStyleFields overlay={overlay} index={index} />

              <div className="subtitles-panel__actions">
                <ToolButton
                  label={t.textOverlay.seek}
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
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
