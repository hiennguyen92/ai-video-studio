import type { JSX } from 'react'
import type { GlossaryEntry } from '../../../../shared/domain/transcript-types'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconTrash } from '../ui/icons'

/**
 * Bảng thuật ngữ riêng (DESCRIPTION §3.E).
 *
 * Tách khỏi panel dịch vì nó có vòng đời riêng: người dùng sửa glossary rồi mới
 * dịch lại, chứ không sửa cùng lúc với việc đọc bản dịch.
 *
 * Component này KHÔNG tự lưu — nó báo cả bảng mới lên cho nơi gọi để ghi bằng
 * một lệnh duy nhất, nhờ vậy một lần hoàn tác trả về đúng một lần chỉnh sửa.
 */

export function TranslationGlossaryEditor({
  glossary,
  disabled,
  onChange
}: {
  glossary: GlossaryEntry[]
  disabled: boolean
  onChange(next: GlossaryEntry[]): void
}): JSX.Element {
  const t = useT()

  const update = (index: number, patch: Partial<GlossaryEntry>): void => {
    onChange(
      glossary.map((entry, position) => (position === index ? { ...entry, ...patch } : entry))
    )
  }

  return (
    <div className="glossary-editor">
      <p className="translate-panel__hint">{t.translate.glossaryHint}</p>

      {glossary.map((entry, index) => (
        // Chỉ mục làm khoá là chấp nhận được ở đây: hàng không sắp xếp lại được,
        // và một mục chưa điền gì thì chưa có giá trị nào để làm khoá ổn định.
        <div key={index} className="glossary-editor__row">
          <input
            type="text"
            value={entry.from}
            placeholder={t.translate.glossaryFrom}
            aria-label={`${t.translate.glossaryFrom} ${index + 1}`}
            disabled={disabled}
            onChange={(event) => update(index, { from: event.target.value })}
          />
          <span className="glossary-editor__arrow">→</span>
          <input
            type="text"
            value={entry.to}
            placeholder={t.translate.glossaryTo}
            aria-label={`${t.translate.glossaryTo} ${index + 1}`}
            disabled={disabled}
            onChange={(event) => update(index, { to: event.target.value })}
          />
          <ToolButton
            label={t.translate.glossaryRemove}
            icon={<IconTrash />}
            iconOnly
            variant="danger"
            disabled={disabled}
            onClick={() => onChange(glossary.filter((_, position) => position !== index))}
          />
        </div>
      ))}

      <div className="translate-panel__actions">
        <ToolButton
          label={t.translate.glossaryAdd}
          variant="outline"
          disabled={disabled}
          onClick={() => onChange([...glossary, { from: '', to: '' }])}
        />
      </div>
    </div>
  )
}
