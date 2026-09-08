import { useCallback, type JSX } from 'react'
import {
  DEFAULT_TEXT_ANIMATION_DURATION_US,
  applyTextOverlayBox,
  createDefaultTextOverlayStyle,
  readTextOverlayBox,
  type TextAnimation,
  type TextExitAnimation,
  type TextOverlay,
  type TextOverlayBox
} from '../../../../shared/domain/text-overlay-types'
import type { SubtitleAlignment } from '../../../../shared/domain/subtitle-types'
import { previewSeekUs } from '../../../../shared/domain/preview-seek'
import { createId } from '../../../../shared/domain/project-document-factory'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconSparkle, IconTrash } from '../ui/icons'

/**
 * Chữ đè lên hình: hook, giá, lời kêu gọi hành động.
 *
 * Nằm trong tab Phụ đề vì cùng là chữ trên hình, nhưng là DỮ LIỆU RIÊNG: dựng lại
 * phụ đề từ bản dịch không được xoá mất dòng CTA người dùng gõ tay.
 */

const ANIMATIONS: Array<{ value: TextAnimation; labelKey: string }> = [
  { value: 'none', labelKey: 'animationNone' },
  { value: 'fade', labelKey: 'animationFade' },
  { value: 'pop', labelKey: 'animationPop' },
  { value: 'slide-up', labelKey: 'animationSlideUp' },
  { value: 'typewriter', labelKey: 'animationTypewriter' }
]

const EXITS: Array<{ value: TextExitAnimation; labelKey: string }> = [
  { value: 'none', labelKey: 'exitNone' },
  { value: 'fade', labelKey: 'exitFade' },
  { value: 'shrink', labelKey: 'exitShrink' },
  { value: 'slide-down', labelKey: 'exitSlideDown' }
]

const BOXES: Array<{ value: TextOverlayBox; labelKey: string }> = [
  { value: 'none', labelKey: 'boxNone' },
  { value: 'dark', labelKey: 'boxDark' },
  { value: 'light', labelKey: 'boxLight' }
]

/** Vị trí theo hệ số bàn phím số của ASS, gói lại thành ba lựa chọn dễ hiểu. */
const POSITIONS: Array<{ value: SubtitleAlignment; labelKey: string }> = [
  { value: 8, labelKey: 'positionTop' },
  { value: 5, labelKey: 'positionMiddle' },
  { value: 2, labelKey: 'positionBottom' }
]

const seconds = (us: number): number => Number((us / 1_000_000).toFixed(2))

export function TextOverlaySection(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const overlays = document?.textOverlays ?? []

  const handleAdd = useCallback(() => {
    const overlay: TextOverlay = {
      id: createId('text'),
      text: '',
      // Bắt đầu ở đầu phát hiện tại: người dùng thường tua tới chỗ cần chữ rồi mới thêm.
      startUs: playheadUs,
      endUs: playheadUs + 3_000_000,
      style: createDefaultTextOverlayStyle(),
      animation: 'pop',
      animationDurationUs: DEFAULT_TEXT_ANIMATION_DURATION_US
    }
    run([{ type: 'text/add', overlay }], 'Thêm chữ')
  }, [playheadUs, run])

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

              <div className="text-overlay-item__row">
                <label>
                  <span className="field-row__label">{t.textOverlay.animation}</span>
                  <select
                    value={overlay.animation}
                    aria-label={`${t.textOverlay.animation} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/update',
                            overlayId: overlay.id,
                            animation: event.target.value as TextAnimation
                          }
                        ],
                        'Đổi hiệu ứng chữ'
                      )
                    }
                  >
                    {ANIMATIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="field-row__label">{t.textOverlay.position}</span>
                  <select
                    value={overlay.style.alignment}
                    aria-label={`${t.textOverlay.position} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/set-style',
                            overlayId: overlay.id,
                            style: {
                              ...overlay.style,
                              alignment: Number(event.target.value) as SubtitleAlignment,
                              // Nằm giữa thì lề dọc vô nghĩa; đặt lại để chữ không lệch.
                              marginVerticalPx: Number(event.target.value) === 5 ? 0 : 160
                            }
                          }
                        ],
                        'Đổi vị trí chữ'
                      )
                    }
                  >
                    {POSITIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="field-row__label">{t.textOverlay.exit}</span>
                  <select
                    value={overlay.exitAnimation ?? 'none'}
                    aria-label={`${t.textOverlay.exit} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/update',
                            overlayId: overlay.id,
                            exitAnimation: event.target.value as TextExitAnimation
                          }
                        ],
                        'Đổi hiệu ứng ra'
                      )
                    }
                  >
                    {EXITS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-overlay-item__toggle">
                  <input
                    type="checkbox"
                    checked={overlay.glow ?? false}
                    aria-label={`${t.textOverlay.glow} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/update',
                            overlayId: overlay.id,
                            glow: event.target.checked
                          }
                        ],
                        'Đổi viền phát sáng'
                      )
                    }
                  />
                  <span className="field-row__label">{t.textOverlay.glow}</span>
                </label>

                <label>
                  <span className="field-row__label">{t.textOverlay.box}</span>
                  <select
                    value={readTextOverlayBox(overlay.style)}
                    aria-label={`${t.textOverlay.box} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/set-style',
                            overlayId: overlay.id,
                            style: applyTextOverlayBox(
                              overlay.style,
                              event.target.value as TextOverlayBox
                            )
                          }
                        ],
                        'Đổi nền chữ'
                      )
                    }
                  >
                    {BOXES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {t.textOverlay[option.labelKey as keyof typeof t.textOverlay] as string}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span className="field-row__label">{t.textOverlay.fontSize}</span>
                  <input
                    type="number"
                    min={12}
                    max={300}
                    value={overlay.style.fontSizePx}
                    aria-label={`${t.textOverlay.fontSize} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'text/set-style',
                            overlayId: overlay.id,
                            style: {
                              ...overlay.style,
                              fontSizePx: Number(event.target.value) || overlay.style.fontSizePx
                            }
                          }
                        ],
                        'Đổi cỡ chữ'
                      )
                    }
                  />
                </label>
              </div>

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
