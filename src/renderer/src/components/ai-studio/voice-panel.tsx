import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ProviderModel, TtsCapabilities } from '../../../../shared/ai/ai-capability-types'
import { defaultParameterValues } from '../../../../shared/ai/ai-capability-types'
import type { Voice } from '../../../../shared/ai/ai-provider-contracts'
import type { AiSettingsSnapshot } from '../../../../shared/ipc/ipc-contract'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useSpeechGeneration } from '../../hooks/use-speech-generation'
import { useAudioInsertion, type InsertMode } from '../../hooks/use-audio-insertion'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconPlay, IconSparkle, IconTrash } from '../ui/icons'
import { ProviderParameterControls } from './provider-parameter-controls'
import { splitScriptIntoSegments, type ScriptSegment } from './voice-script-segments'
import './voice-panel.css'

/**
 * Tab Giọng đọc (DESCRIPTION §3.B).
 *
 * Toàn bộ ô điều khiển tham số được dựng từ khai báo năng lực của provider, nên
 * đổi provider hoặc đổi model là bộ điều khiển tự đổi theo. Không có tham số nào
 * được viết cứng trong file này.
 */

const LANGUAGE_OPTIONS = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: '', label: '—' }
]

export function VoicePanel({
  onOpenSettings,
  credentialsVersion = 0
}: {
  onOpenSettings(): void
  /** Đổi giá trị này để panel nạp lại trạng thái khoá API. */
  credentialsVersion?: number
}): JSX.Element {
  const t = useT()

  /** Nhãn ngắn cho phân loại giọng của provider. */
  const categoryLabel = (category: string): string =>
    category === 'premade'
      ? t.voice.voiceCategoryPremade
      : category === 'professional'
        ? t.voice.voiceCategoryProfessional
        : category

  const document = useEditorStore(selectDocument)
  const { insertAudio, canReplaceSelection } = useAudioInsertion()
  const { states, generate, cancel } = useSpeechGeneration()

  const [settings, setSettings] = useState<AiSettingsSnapshot | null>(null)
  const [providerId, setProviderId] = useState('')
  const [models, setModels] = useState<ProviderModel[]>([])
  const [model, setModel] = useState('')
  const [capabilities, setCapabilities] = useState<TtsCapabilities | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [language, setLanguage] = useState('vi')
  const [parameters, setParameters] = useState<Record<string, number | string | boolean>>({})
  const [outputFormat, setOutputFormat] = useState('')
  const [script, setScript] = useState('')
  const [segments, setSegments] = useState<ScriptSegment[]>([])
  const [insertMode, setInsertMode] = useState<InsertMode>('playhead')
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* ── Nạp provider có làm được tác vụ giọng đọc ─────────────── */

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.settings()
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSettings(result.data)
      const ttsProviders = result.data.providers.filter((entry) =>
        entry.descriptor.tasks.includes('tts')
      )
      // Ưu tiên provider đã có khoá — chọn sẵn cái dùng được ngay.
      const preferred = ttsProviders.find((entry) => entry.hasCredential) ?? ttsProviders[0]
      // Chỉ tự chọn provider ở lần nạp đầu; những lần nạp sau là do khoá thay
      // đổi, không được giật lựa chọn khỏi tay người dùng.
      setProviderId((current) => current || (preferred?.descriptor.id ?? ''))
    })()
    return () => {
      cancelled = true
    }
  }, [credentialsVersion])

  useEffect(() => {
    if (!providerId) return
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.listModels(providerId)
      if (cancelled || !result.ok) return
      setModels(result.data)
      setModel((current) =>
        result.data.some((item) => item.id === current) ? current : (result.data[0]?.id ?? '')
      )
      setVoices([])
      setVoiceId('')
    })()
    return () => {
      cancelled = true
    }
    // Phụ thuộc cả credentialsVersion: với provider đọc model qua API, lần nạp
    // đầu lúc chưa có khoá sẽ thất bại và danh sách model rỗng. Không nạp lại thì
    // panel kẹt ở trạng thái không có model, kéo theo không có cả năng lực lẫn
    // nút tải giọng.
  }, [providerId, credentialsVersion])

  useEffect(() => {
    if (!providerId || !model) return
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.capabilities(providerId, model)
      if (cancelled || !result.ok) return
      setCapabilities(result.data)
      setParameters(defaultParameterValues(result.data.parameters))
      setOutputFormat(result.data.outputFormats[0]?.value ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [providerId, model])

  const providerStatus = settings?.providers.find((entry) => entry.descriptor.id === providerId)
  const hasCredential = providerStatus?.hasCredential ?? false
  // Máy chủ tự host thường chạy không xác thực; đừng chặn oan.
  const credentialRequired = providerStatus?.descriptor.credentialRequired ?? true
  const ready = hasCredential || !credentialRequired

  const loadVoices = useCallback(async () => {
    if (!providerId) return
    setLoadingVoices(true)
    setError(null)
    try {
      const result = await window.api.ai.listVoices({
        providerId,
        language: capabilities?.supportsLanguageFilter && language ? language : undefined
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setVoices(result.data)
      setVoiceId((current) =>
        result.data.some((voice) => voice.id === current) ? current : (result.data[0]?.id ?? '')
      )
    } finally {
      setLoadingVoices(false)
    }
  }, [providerId, language, capabilities?.supportsLanguageFilter])

  // Danh mục cố định không tốn lời gọi mạng nên nạp luôn; danh mục lấy từ tài
  // khoản thì đợi người dùng bấm, tránh gọi API khi họ chỉ ghé qua tab.
  // Gọi thẳng ở đây thay vì dùng `loadVoices` để mọi cập nhật state đều nằm sau
  // một `await`, không phải trong thân đồng bộ của effect.
  useEffect(() => {
    if (capabilities?.voiceCatalog !== 'static' || !providerId) return
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.listVoices({ providerId })
      if (cancelled || !result.ok) return
      setVoices(result.data)
      setVoiceId((current) =>
        result.data.some((voice) => voice.id === current) ? current : (result.data[0]?.id ?? '')
      )
    })()
    return () => {
      cancelled = true
    }
  }, [capabilities?.voiceCatalog, providerId])

  /* ── Kịch bản ──────────────────────────────────────────────── */

  const handleSplit = useCallback(() => {
    setSegments(
      splitScriptIntoSegments(script, { maxCharacters: capabilities?.maxCharactersPerRequest })
    )
  }, [script, capabilities?.maxCharactersPerRequest])

  const updateSegmentText = useCallback((segmentId: string, text: string) => {
    setSegments((current) =>
      current.map((segment) => (segment.id === segmentId ? { ...segment, text } : segment))
    )
  }, [])

  const removeSegment = useCallback((segmentId: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== segmentId))
  }, [])

  const generateSegment = useCallback(
    (segment: ScriptSegment) => {
      if (!providerId || !model || !voiceId || !outputFormat) return
      void generate({
        segmentId: segment.id,
        text: segment.text,
        providerId,
        model,
        voiceId,
        language: language || undefined,
        parameters,
        outputFormat
      })
    },
    [generate, providerId, model, voiceId, outputFormat, language, parameters]
  )

  const generateAll = useCallback(() => {
    for (const segment of segments) {
      if (states[segment.id]?.status === 'succeeded') continue
      generateSegment(segment)
    }
  }, [segments, states, generateSegment])

  const readyAssetIds = useMemo(
    () =>
      segments
        .map((segment) => states[segment.id]?.assetId)
        .filter((assetId): assetId is string => Boolean(assetId)),
    [segments, states]
  )

  const handleInsert = useCallback(() => {
    const inserted = insertAudio({
      assetIds: readyAssetIds,
      mode: insertMode,
      role: 'voiceover',
      newTrackName: 'Lồng tiếng'
    })
    if (!inserted) setError(t.voice.emptyScript)
  }, [insertAudio, readyAssetIds, insertMode, t.voice.emptyScript])

  const selectedVoice = voices.find((voice) => voice.id === voiceId)
  const limit = capabilities?.maxCharactersPerRequest

  if (!document) return <EmptyState title={t.app.loading} hint={t.voice.emptyScript} />

  return (
    <div className="voice-panel">
      {!ready && providerStatus && (
        <div className="notice notice--warning voice-panel__missing-key">
          <span>{t.voice.missingKey}</span>
          <ToolButton label={t.voice.openSettings} variant="outline" onClick={onOpenSettings} />
        </div>
      )}

      {error && <div className="notice">{interpolate(t.errors.generic, { message: error })}</div>}

      {/* ── Chọn provider, model, giọng ── */}
      <div className="field-row">
        <span className="field-row__label">{t.voice.provider}</span>
        <select
          value={providerId}
          onChange={(event) => setProviderId(event.target.value)}
          aria-label={t.voice.provider}
        >
          {settings?.providers
            .filter((entry) => entry.descriptor.tasks.includes('tts'))
            .map((entry) => (
              <option key={entry.descriptor.id} value={entry.descriptor.id}>
                {entry.descriptor.name}
                {entry.hasCredential || !entry.descriptor.credentialRequired
                  ? ''
                  : ' — chưa có khoá'}
              </option>
            ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.voice.model}</span>
        <select
          value={model}
          onChange={(event) => setModel(event.target.value)}
          aria-label={t.voice.model}
        >
          {models.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {capabilities?.supportsLanguageFilter && (
        <div className="field-row">
          <span className="field-row__label">{t.voice.language}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            aria-label={t.voice.language}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Máy chủ tự host không công bố danh sách giọng và cũng không dò ra được:
          để người dùng gõ tên giọng, thay vì bày một danh sách bịa. */}
      {capabilities?.voiceCatalog === 'manual' && voices.length === 0 ? (
        <div className="field-row">
          <span className="field-row__label">{t.voice.voiceManualLabel}</span>
          {/* Vẫn giữ nút dò danh sách bên cạnh ô gõ tay: một số máy chủ tự host
              CÓ endpoint liệt kê giọng, và không cho người dùng cách nào để thử
              thì họ buộc phải gõ mò tên giọng. */}
          <div className="voice-panel__voice-row">
            <input
              type="text"
              value={voiceId}
              spellCheck={false}
              placeholder={t.voice.voiceManualPlaceholder}
              aria-label={t.voice.voiceManualLabel}
              onChange={(event) => setVoiceId(event.target.value)}
            />
            <ToolButton
              label={loadingVoices ? t.voice.loadingVoices : t.voice.loadVoices}
              variant="outline"
              onClick={() => void loadVoices()}
              disabled={loadingVoices}
            />
          </div>
        </div>
      ) : (
        <div className="field-row">
          <span className="field-row__label">{t.voice.voice}</span>
          <div className="voice-panel__voice-row">
            <select
              value={voiceId}
              onChange={(event) => setVoiceId(event.target.value)}
              aria-label={t.voice.voice}
              disabled={voices.length === 0}
            >
              {voices.length === 0 && <option value="">{t.voice.noVoices}</option>}
              {voices.map((voice) => (
                <option key={voice.id} value={voice.id}>
                  {voice.verifiedForLanguage ? '✓ ' : ''}
                  {voice.name}
                  {voice.category ? ` · ${categoryLabel(voice.category)}` : ''}
                  {voice.verifiedForLanguage ? ` · ${t.voice.voiceVerifiedBadge}` : ''}
                </option>
              ))}
            </select>
            {capabilities?.voiceCatalog !== 'static' && (
              <ToolButton
                label={loadingVoices ? t.voice.loadingVoices : t.voice.loadVoices}
                variant="outline"
                onClick={() => void loadVoices()}
                disabled={loadingVoices || (!hasCredential && credentialRequired)}
              />
            )}
          </div>
        </div>
      )}

      <p className="voice-panel__catalog-note">
        {capabilities?.voiceCatalog === 'remote'
          ? t.voice.voiceCatalogRemote
          : capabilities?.voiceCatalog === 'manual'
            ? t.voice.voiceCatalogManual
            : t.voice.voiceCatalogStatic}
      </p>

      {/* Giọng thư viện bị gói miễn phí từ chối lúc tạo — nói trước để người
          dùng không bấm tạo rồi mới gặp lỗi thanh toán. */}
      {voices.some((voice) => voice.category === 'professional') && (
        <p className="voice-panel__catalog-note">{t.voice.voiceCategoryNote}</p>
      )}

      {capabilities?.supportsLanguageFilter && (
        <p className="voice-panel__catalog-note">{t.voice.languageFilterNote}</p>
      )}

      {selectedVoice?.previewUrl && (
        <audio
          className="voice-panel__preview"
          controls
          src={selectedVoice.previewUrl}
          aria-label={t.voice.previewVoice}
        />
      )}
      {capabilities && !capabilities.supportsVoicePreviewSample && (
        <p className="voice-panel__catalog-note">{t.voice.noPreviewAvailable}</p>
      )}

      {/* ── Tham số do provider khai báo ── */}
      {capabilities && (
        <>
          <p className="field-group__title">{t.voice.parameters}</p>
          {capabilities.parameters.length === 0 ? (
            <p className="voice-panel__catalog-note">{t.voice.noParameters}</p>
          ) : (
            <ProviderParameterControls
              parameters={capabilities.parameters}
              values={parameters}
              onChange={(key, value) => setParameters((current) => ({ ...current, [key]: value }))}
            />
          )}

          <div className="field-row">
            <span className="field-row__label">{t.voice.outputFormat}</span>
            <select
              value={outputFormat}
              onChange={(event) => setOutputFormat(event.target.value)}
              aria-label={t.voice.outputFormat}
            >
              {capabilities.outputFormats.map((format) => (
                <option key={format.value} value={format.value}>
                  {format.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* ── Kịch bản ── */}
      <p className="field-group__title">{t.voice.script}</p>
      <textarea
        className="voice-panel__script"
        value={script}
        onChange={(event) => setScript(event.target.value)}
        placeholder={t.voice.scriptPlaceholder}
        aria-label={t.voice.script}
        rows={6}
      />
      <div className="voice-panel__script-actions">
        <ToolButton
          label={t.voice.splitIntoSegments}
          variant="outline"
          onClick={handleSplit}
          disabled={!script.trim()}
        />
        {segments.length > 0 && (
          <span className="field-row__value">
            {interpolate(t.voice.segmentCount, { count: segments.length })}
          </span>
        )}
      </div>

      {segments.length === 0 && (
        <EmptyState title={t.voice.emptyScript} hint={t.voice.scriptPlaceholder} />
      )}

      {/* ── Danh sách đoạn ── */}
      {segments.map((segment, index) => {
        const state = states[segment.id] ?? { status: 'idle' as const }
        const asset = state.assetId
          ? document.assets.find((item) => item.id === state.assetId)
          : undefined
        const tooLong = limit !== undefined && segment.text.length > limit
        const busy = state.status === 'queued' || state.status === 'running'

        return (
          <article key={segment.id} className="script-segment">
            <header className="script-segment__header">
              <span className="script-segment__index">{index + 1}</span>
              <span className="script-segment__meta">
                {interpolate(t.voice.characters, { count: segment.text.length })}
                {tooLong && (
                  <span className="script-segment__warning">
                    {' · '}
                    {interpolate(t.voice.overLimit, { limit: limit ?? 0 })}
                  </span>
                )}
                {state.fromCache && ` · ${t.jobs.fromCache}`}
              </span>
              <ToolButton
                label={t.common.remove}
                icon={<IconTrash />}
                iconOnly
                variant="danger"
                onClick={() => removeSegment(segment.id)}
                disabled={busy}
              />
            </header>

            <textarea
              className="script-segment__text"
              value={segment.text}
              onChange={(event) => updateSegmentText(segment.id, event.target.value)}
              aria-label={`${t.voice.script} ${index + 1}`}
              rows={2}
            />

            <div className="script-segment__actions">
              {busy ? (
                <ToolButton
                  label={t.jobs.cancel}
                  variant="danger"
                  onClick={() => void cancel(segment.id)}
                />
              ) : (
                <ToolButton
                  label={
                    state.status === 'succeeded' ? t.voice.regenerate : t.voice.generateSegment
                  }
                  icon={<IconSparkle />}
                  variant={state.status === 'succeeded' ? 'ghost' : 'outline'}
                  onClick={() => generateSegment(segment)}
                  disabled={!ready || !voiceId || tooLong}
                />
              )}

              {busy && <span className="script-segment__status">{t.voice.generating}</span>}

              {asset && (
                <>
                  <audio
                    className="script-segment__audio"
                    controls
                    src={mediaFileUrl(asset.source.path)}
                    aria-label={t.voice.listen}
                  />
                  <span className="field-row__value">
                    {formatClockTime(asset.probe.durationUs)}
                  </span>
                </>
              )}

              {state.status === 'failed' && (
                <span className="script-segment__error">
                  {state.error}
                  {state.retryable === false ? '' : ` · ${t.jobs.retry}`}
                </span>
              )}
            </div>
          </article>
        )
      })}

      {/* ── Chèn vào timeline ── */}
      {segments.length > 0 && (
        <div className="voice-panel__insert">
          <ToolButton
            label={t.voice.generate}
            icon={<IconSparkle />}
            variant="primary"
            onClick={generateAll}
            disabled={!ready || !voiceId || segments.length === 0}
          />

          <select
            value={insertMode}
            onChange={(event) => setInsertMode(event.target.value as InsertMode)}
            aria-label={t.voice.insertAtPlayhead}
          >
            <option value="playhead">{t.voice.insertAtPlayhead}</option>
            <option value="new-track">{t.voice.insertNewTrack}</option>
            <option value="replace-selected" disabled={!canReplaceSelection}>
              {t.voice.replaceSelected}
            </option>
          </select>

          <ToolButton
            label={t.voice.insertAtPlayhead}
            icon={<IconPlay />}
            variant="outline"
            onClick={handleInsert}
            disabled={readyAssetIds.length === 0}
          />
        </div>
      )}
    </div>
  )
}
