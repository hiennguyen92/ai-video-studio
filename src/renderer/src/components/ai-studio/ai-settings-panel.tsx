import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AiSettingsSnapshot } from '../../../../shared/ipc/ipc-contract'
import type { ConnectionTestResult } from '../../../../shared/ai/ai-capability-types'
import { interpolate, useT } from '../../i18n/use-translation'
import { PanelSubtabs } from '../ui/panel-subtabs'
import {
  AI_SETTINGS_SECTIONS,
  AI_SETTINGS_SECTION_TASK,
  type AiSettingsSection
} from './ai-settings-sections'
import { McpConnectionSection } from './mcp-connection-section'
import { ProviderCard } from './provider-card'
import './ai-settings-panel.css'

/**
 * Tab Cấu hình AI (DESCRIPTION §3.G), chia tab con theo loại việc: Voice, Transcribe,
 * Translate, Music, MCP. Mỗi tab chỉ hiện provider làm được việc đó — trước đây mọi
 * provider xếp chung một cột dài, tìm ô của whisper.cpp phải cuộn qua cả loạt dịch vụ
 * giọng đọc.
 *
 * Ô nhập khoá là `type="password"` và giá trị KHÔNG bao giờ được đọc ngược từ
 * tiến trình main: sau khi lưu, ô được xoá trắng và trạng thái chỉ còn là "đã có
 * khoá". Renderer không có cách nào lấy lại khoá, kể cả khi có mã lạ chạy trong trang.
 */
const SECTION_LABEL_KEYS = {
  voice: 'sectionVoice',
  transcribe: 'sectionTranscribe',
  translate: 'sectionTranslate',
  music: 'sectionMusic',
  mcp: 'sectionMcp'
} as const satisfies Record<AiSettingsSection, string>

const SECTION_HINT_KEYS = {
  voice: 'sectionVoiceHint',
  transcribe: 'sectionTranscribeHint',
  translate: 'sectionTranslateHint',
  music: 'sectionMusicHint'
} as const satisfies Record<Exclude<AiSettingsSection, 'mcp'>, string>

export function AiSettingsPanel({
  section,
  onSectionChange,
  onCredentialsChanged
}: {
  /** Tab con đang mở; do panel AI Studio giữ để nút "Mở Cấu hình AI" mở đúng tab. */
  section: AiSettingsSection
  onSectionChange(section: AiSettingsSection): void
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

  return (
    <div className="ai-settings">
      <PanelSubtabs<AiSettingsSection>
        label={t.aiSettings.title}
        active={section}
        onChange={onSectionChange}
        tabs={AI_SETTINGS_SECTIONS.map((key) => ({
          key,
          label: t.aiSettings[SECTION_LABEL_KEYS[key]]
        }))}
      />

      {section !== 'mcp' && (
        <p className="ai-settings__section-hint">{t.aiSettings[SECTION_HINT_KEYS[section]]}</p>
      )}

      {/* Lời dặn về khoá API chỉ có nghĩa ở các tab provider, không ở MCP. */}
      {section !== 'mcp' && <p className="ai-settings__intro">{t.aiSettings.intro}</p>}

      {section !== 'mcp' && snapshot && !snapshot.encryption.available && (
        <div className="notice">{t.aiSettings.storageUnavailable}</div>
      )}
      {section !== 'mcp' && snapshot?.encryption.available && (
        <p className="ai-settings__storage">
          {interpolate(t.aiSettings.storageOk, { backend: snapshot.encryption.backend })}
        </p>
      )}

      {error && <div className="notice">{interpolate(t.errors.generic, { message: error })}</div>}
      {notice && <p className="ai-settings__notice">{notice}</p>}

      {section === 'mcp' && <McpConnectionSection />}

      {section !== 'mcp' &&
        snapshot?.providers
          .filter((entry) => entry.descriptor.tasks.includes(AI_SETTINGS_SECTION_TASK[section]))
          .map((entry) => {
            const providerId = entry.descriptor.id
            const name = entry.descriptor.name
            return (
              <ProviderCard
                key={providerId}
                entry={entry}
                busy={busyProvider === providerId}
                encryptionAvailable={snapshot.encryption.available}
                keyDraft={drafts[providerId] ?? ''}
                configDraft={configDrafts[providerId]}
                test={testResults[providerId]}
                onKeyDraftChange={(value) =>
                  setDrafts((current) => ({ ...current, [providerId]: value }))
                }
                onConfigDraftChange={(field, value) =>
                  setConfigDrafts((current) => ({
                    ...current,
                    [providerId]: { ...(current[providerId] ?? entry.config), [field]: value }
                  }))
                }
                onSaveKey={() => void handleSave(providerId, name)}
                onSaveConfig={() => void handleSaveConfig(providerId, name)}
                onTest={() => void handleTest(providerId)}
                onRemove={() => void handleRemove(providerId, name)}
              />
            )
          })}
    </div>
  )
}
