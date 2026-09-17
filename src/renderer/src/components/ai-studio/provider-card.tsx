import type { JSX } from 'react'
import type { ConnectionTestResult } from '../../../../shared/ai/ai-capability-types'
import type { AiSettingsSnapshot } from '../../../../shared/ipc/ipc-contract'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

type ProviderEntry = AiSettingsSnapshot['providers'][number]

/**
 * Thẻ cấu hình MỘT provider: trạng thái khoá, ô cấu hình dựng từ khai báo của
 * provider, ô nhập khoá, kiểm tra kết nối, xoá khoá.
 *
 * Ô nhập khoá là `type="password"` và giá trị không bao giờ đọc ngược từ tiến trình
 * main; state và thao tác nằm ở panel cha, thẻ chỉ hiển thị và báo sự kiện lên.
 */
export function ProviderCard({
  entry,
  busy,
  encryptionAvailable,
  keyDraft,
  configDraft,
  test,
  onKeyDraftChange,
  onConfigDraftChange,
  onSaveKey,
  onSaveConfig,
  onTest,
  onRemove
}: {
  entry: ProviderEntry
  busy: boolean
  encryptionAvailable: boolean
  keyDraft: string
  configDraft: Record<string, string> | undefined
  test: ConnectionTestResult | undefined
  onKeyDraftChange(value: string): void
  onConfigDraftChange(field: string, value: string): void
  onSaveKey(): void
  onSaveConfig(): void
  onTest(): void
  onRemove(): void
}): JSX.Element {
  const t = useT()
  const { descriptor, hasCredential, config } = entry
  const fields = descriptor.configFields ?? []

  return (
    <section className="provider-card">
      <header className="provider-card__header">
        <span className="provider-card__name">{descriptor.name}</span>
        <span className={`provider-card__badge ${hasCredential ? 'provider-card__badge--ok' : ''}`}>
          {hasCredential
            ? t.aiSettings.configured
            : descriptor.credentialRequired
              ? t.aiSettings.notConfigured
              : t.aiSettings.noCredentialNeeded}
        </span>
      </header>

      {descriptor.noteVi && <p className="provider-card__note">{descriptor.noteVi}</p>}

      {/* Ô cấu hình dựng TỪ khai báo của provider — không viết cứng ô nào cho riêng
          một provider, y như cách tham số model được dựng. */}
      {fields.map((field) => {
        const saved = config[field.key] ?? field.defaultValue ?? ''
        const draft = configDraft?.[field.key]
        return (
          <label key={field.key} className="provider-card__config">
            <span className="field-row__label">
              {field.labelVi}
              {field.required ? ' *' : ''}
            </span>
            <input
              type="text"
              value={draft ?? saved}
              placeholder={field.placeholder}
              title={field.hintVi}
              spellCheck={false}
              disabled={busy}
              onChange={(event) => onConfigDraftChange(field.key, event.target.value)}
            />
          </label>
        )
      })}

      {fields.length > 0 && (
        <ToolButton
          label={t.aiSettings.configSave}
          variant="outline"
          onClick={onSaveConfig}
          disabled={busy || !configDraft}
        />
      )}

      <div className="provider-card__key-row">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={keyDraft}
          onChange={(event) => onKeyDraftChange(event.target.value)}
          placeholder={t.aiSettings.keyPlaceholder}
          aria-label={`${descriptor.name} ${descriptor.credentialLabel}`}
          disabled={busy || !encryptionAvailable}
        />
        <ToolButton
          label={t.aiSettings.save}
          variant="primary"
          onClick={onSaveKey}
          disabled={busy || !keyDraft.trim()}
        />
      </div>

      <div className="provider-card__actions">
        <ToolButton
          label={busy ? t.aiSettings.testing : t.aiSettings.test}
          variant="outline"
          onClick={onTest}
          disabled={busy || (!hasCredential && descriptor.credentialRequired)}
        />
        <ToolButton
          label={t.aiSettings.remove}
          variant="danger"
          onClick={onRemove}
          disabled={busy || !hasCredential}
        />
        <a
          className="provider-card__link"
          href={descriptor.credentialHelpUrl}
          target="_blank"
          rel="noreferrer"
        >
          {t.aiSettings.getKey}
        </a>
      </div>

      {test && (
        <p
          className={`provider-card__test ${test.ok ? 'provider-card__test--ok' : 'provider-card__test--fail'}`}
        >
          {test.ok ? t.aiSettings.testOk : t.aiSettings.testFailed}
          {test.details ? ` · ${test.details}` : ''}
          {!test.ok && test.message ? ` · ${test.message}` : ''}
        </p>
      )}
    </section>
  )
}
