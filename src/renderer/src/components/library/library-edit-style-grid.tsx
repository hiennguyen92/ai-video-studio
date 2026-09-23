import { useState, type JSX } from 'react'
import { EDIT_STYLES } from '../../../../shared/domain/edit-style-catalog'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import {
  applyEditStyle,
  previewEditStyle,
  type EditStylePlan
} from '../../state/edit-style-actions'
import { interpolate, useLocale } from '../../i18n/use-translation'
import { EDIT_STYLE_LABEL_KEYS } from './edit-style-labels'

/**
 * Tab Kiểu dựng: mỗi thẻ là một cách dựng cả timeline.
 *
 * Bấm thẻ KHÔNG áp ngay — nó mở phần xem trước, liệt kê đúng những việc sẽ làm
 * trên tài liệu đang mở. Một cú bấm viết lại cả timeline mà không báo trước là
 * thứ đáng sợ, kể cả khi hoàn tác được.
 *
 * Áp xong gộp thành MỘT bước hoàn tác, nên muốn quay lại chỉ cần một lần.
 */
export function LibraryEditStyleGrid(): JSX.Element {
  const { t } = useLocale()
  const document = useEditorStore(selectDocument)
  const [openId, setOpenId] = useState<string | null>(null)
  const [plan, setPlan] = useState<EditStylePlan | { error: string } | null>(null)
  const [applied, setApplied] = useState<string | null>(null)

  const open = (styleId: string): void => {
    if (openId === styleId) {
      setOpenId(null)
      return
    }
    setOpenId(styleId)
    setApplied(null)
    setPlan(previewEditStyle(styleId))
  }

  const apply = (styleId: string, name: string): void => {
    const result = applyEditStyle(styleId, name)
    setApplied(result.ok ? t.library.editStyleApplied : result.error)
    // Lập lại bản xem trước: timeline vừa đổi, nên những việc sẽ làm cũng đổi.
    if (result.ok) setPlan(previewEditStyle(styleId))
  }

  return (
    <div className="library-grid-section">
      <p className="library-hint">
        {document ? t.library.editStyleHint : t.library.editStyleNoProject}
      </p>

      <div className="edit-style-list">
        {EDIT_STYLES.map((style) => {
          const labels = EDIT_STYLE_LABEL_KEYS[style.id]
          const name = t.library[labels.name]
          const isOpen = openId === style.id
          return (
            <div key={style.id} className="edit-style" data-edit-style={style.id}>
              <button
                type="button"
                className={`edit-style__head ${isOpen ? 'edit-style__head--open' : ''}`}
                aria-expanded={isOpen}
                onClick={() => open(style.id)}
                disabled={!document}
              >
                <span className="edit-style__name">{name}</span>
                <span className="edit-style__aspect">{style.aspect}</span>
                <span className="edit-style__note">{t.library[labels.note]}</span>
              </button>

              {isOpen && plan && (
                <div className="edit-style__plan">
                  {'error' in plan ? (
                    <p className="inspector__hint inspector__hint--warn">{plan.error}</p>
                  ) : (
                    <>
                      <ol className="edit-style__steps">
                        {plan.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ol>
                      {plan.steps.length === 0 && (
                        <p className="inspector__hint inspector__hint--warn">
                          {t.library.editStyleNothingToDo}
                        </p>
                      )}
                      {plan.aspectWarning && (
                        <p className="inspector__hint inspector__hint--warn">
                          {interpolate(t.library.editStyleAspectWarning, plan.aspectWarning)}
                        </p>
                      )}
                      {plan.failures.map((failure, index) => (
                        <p key={index} className="inspector__hint inspector__hint--warn">
                          {failure.tool}: {failure.reason}
                        </p>
                      ))}
                      <div className="edit-style__actions">
                        <button
                          type="button"
                          className="button button--primary"
                          disabled={plan.commandCount === 0}
                          onClick={() => apply(style.id, name)}
                        >
                          {t.library.editStyleApply}
                        </button>
                        {applied && <span className="edit-style__applied">{applied}</span>}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
