import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AiSettingsSnapshot } from '../../../../shared/ipc/ipc-contract'
import type { ConnectionTestResult } from '../../../../shared/ai/ai-capability-types'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { McpConnectionSection } from './mcp-connection-section'
import './ai-settings-panel.css'

/**
 * Tab Cấu hình AI (DESCRIPTION §3.G).
 *
 * Ô nhập khoá là `type="password"` và giá trị KHÔNG bao giờ được đọc ngược từ
 * tiến trình main: sau khi lưu, ô được xoá trắng và trạng thái chỉ còn là "đã có
 * khoá". Renderer không có cách nào lấy lại khoá, kể cả khi có mã lạ chạy trong trang.
 */
export function AiSettingsPanel({
  onCredentialsChanged
}: {
  onCredentialsChanged?(): void
}): JSX.Element {
  const t = useT()
  const [snapshot, setSnapshot] = useState<AiSettingsSnapshot | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  /** providerId -> { field -> value } đang soạn. */
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, string>>>({})
  const [busyProvider, setBusyProvider] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const result = await window.api.ai.settings()
    if (result.ok) setSnapshot(result.data)
    else setError(result.error)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.settings()
      if (cancelled) return
      if (result.ok) setSnapshot(result.data)
      else setError(result.error)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = useCallback(
    async (providerId: string, providerName: string) => {
      const key = (drafts[providerId] ?? '').trim()
      if (!key) return
      setBusyProvider(providerId)
      setError(null)
      try {
        const result = await window.api.ai.setCredential(providerId, key)
        if (!result.ok) {
          setError(result.error)
          return
        }
        // Xoá bản nháp ngay: không giữ khoá trong state của renderer lâu hơn mức cần.
        setDrafts((current) => ({ ...current, [providerId]: '' }))
        setNotice(interpolate(t.aiSettings.saved, { provider: providerName }))
        await refresh()
        onCredentialsChanged?.()
      } finally {
        setBusyProvider(null)
      }
    },
    [drafts, refresh, t.aiSettings.saved, onCredentialsChanged]
  )

  const handleRemove = useCallback(
    async (providerId: string, providerName: string) => {
      setBusyProvider(providerId)
      try {
        const result = await window.api.ai.deleteCredential(providerId)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setTestResults((current) => {
          const next = { ...current }
          delete next[providerId]
          return next
        })
        setNotice(interpolate(t.aiSettings.removed, { provider: providerName }))
        await refresh()
        onCredentialsChanged?.()
      } finally {
        setBusyProvider(null)
      }
    },
    [refresh, t.aiSettings.removed, onCredentialsChanged]
  )

  const handleSaveConfig = useCallback(
    async (providerId: string, providerName: string) => {
      const config = configDrafts[providerId]
      if (!config) return
      setBusyProvider(providerId)
      try {
        const result = await window.api.ai.setConfig(providerId, config)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setNotice(interpolate(t.aiSettings.configSaved, { provider: providerName }))
        await refresh()
        onCredentialsChanged?.()
      } finally {
        setBusyProvider(null)
      }
    },
    [configDrafts, refresh, t.aiSettings.configSaved, onCredentialsChanged]
  )

  const handleTest = useCallback(async (providerId: string) => {
    setBusyProvider(providerId)
    try {
      const result = await window.api.ai.testConnection(providerId)
      setTestResults((current) => ({
        ...current,
        [providerId]: result.ok ? result.data : { ok: false, message: result.error }
      }))
    } finally {
      setBusyProvider(null)
    }
  }, [])

  const taskLabel = (task: string): string =>
    task === 'tts'
      ? t.aiSettings.taskTts
      : task === 'stt'
        ? t.aiSettings.taskStt
        : task === 'translate'
          ? t.aiSettings.taskTranslate
          : t.aiSettings.taskMusic

  return (
    <div className="ai-settings">
      <p className="ai-settings__intro">{t.aiSettings.intro}</p>

      {snapshot && !snapshot.encryption.available && (
        <div className="notice">{t.aiSettings.storageUnavailable}</div>
      )}
      {snapshot?.encryption.available && (
        <p className="ai-settings__storage">
          {interpolate(t.aiSettings.storageOk, { backend: snapshot.encryption.backend })}
        </p>
      )}

      {error && <div className="notice">{interpolate(t.errors.generic, { message: error })}</div>}
      {notice && <p className="ai-settings__notice">{notice}</p>}

      {snapshot?.providers.map(({ descriptor, hasCredential, config }) => {
        const busy = busyProvider === descriptor.id
        const test = testResults[descriptor.id]

        return (
          <section key={descriptor.id} className="provider-card">
            <header className="provider-card__header">
              <span className="provider-card__name">{descriptor.name}</span>
              <span
                className={`provider-card__badge ${hasCredential ? 'provider-card__badge--ok' : ''}`}
              >
                {hasCredential
                  ? t.aiSettings.configured
                  : descriptor.credentialRequired
                    ? t.aiSettings.notConfigured
                    : t.aiSettings.noCredentialNeeded}
              </span>
            </header>

            <p className="provider-card__tasks">
              {t.aiSettings.tasksLabel}: {descriptor.tasks.map(taskLabel).join(', ')}
            </p>

            {descriptor.noteVi && <p className="provider-card__note">{descriptor.noteVi}</p>}

            {/* Ô cấu hình dựng TỪ khai báo của provider — không viết cứng ô nào
                cho riêng một provider, y như cách tham số model được dựng. */}
            {(descriptor.configFields ?? []).map((field) => {
              const saved = config[field.key] ?? field.defaultValue ?? ''
              const draft = configDrafts[descriptor.id]?.[field.key]
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
                    onChange={(event) =>
                      setConfigDrafts((current) => ({
                        ...current,
                        [descriptor.id]: {
                          ...(current[descriptor.id] ?? config),
                          [field.key]: event.target.value
                        }
                      }))
                    }
                  />
                </label>
              )
            })}

            {(descriptor.configFields ?? []).length > 0 && (
              <ToolButton
                label={t.aiSettings.configSave}
                variant="outline"
                onClick={() => void handleSaveConfig(descriptor.id, descriptor.name)}
                disabled={busy || !configDrafts[descriptor.id]}
              />
            )}

            <div className="provider-card__key-row">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={drafts[descriptor.id] ?? ''}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [descriptor.id]: event.target.value }))
                }
                placeholder={t.aiSettings.keyPlaceholder}
                aria-label={`${descriptor.name} ${descriptor.credentialLabel}`}
                disabled={busy || snapshot?.encryption.available === false}
              />
              <ToolButton
                label={t.aiSettings.save}
                variant="primary"
                onClick={() => void handleSave(descriptor.id, descriptor.name)}
                disabled={busy || !(drafts[descriptor.id] ?? '').trim()}
              />
            </div>

            <div className="provider-card__actions">
              <ToolButton
                label={busy ? t.aiSettings.testing : t.aiSettings.test}
                variant="outline"
                onClick={() => void handleTest(descriptor.id)}
                disabled={busy || (!hasCredential && descriptor.credentialRequired)}
              />
              <ToolButton
                label={t.aiSettings.remove}
                variant="danger"
                onClick={() => void handleRemove(descriptor.id, descriptor.name)}
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
      })}

      <McpConnectionSection />
    </div>
  )
}
