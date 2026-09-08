import { useCallback, useEffect, useState, type JSX } from 'react'
import { useMusicGeneration } from '../../hooks/use-music-generation'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconSparkle } from '../ui/icons'

/**
 * Tạo nhạc bằng mô tả (Mốc 4).
 *
 * Tách khỏi phần còn lại của tab Nhạc nền vì nó là thứ DUY NHẤT ở đó cần khoá
 * API. Thiếu khoá thì chỉ phần này bị chặn, còn tải nhạc lên và chèn vào timeline
 * vẫn dùng bình thường (DESCRIPTION §3.G).
 */

const PROVIDER_ID = 'elevenlabs-music'
const DEFAULT_MODEL = 'music_v1'

/** Giới hạn của provider, theo tài liệu chính thức: 3 giây tới 10 phút. */
const MIN_SECONDS = 3
const MAX_SECONDS = 600

export function MusicGenerationSection({
  onOpenSettings,
  credentialsVersion
}: {
  onOpenSettings(): void
  credentialsVersion: number
}): JSX.Element {
  const t = useT()
  const { state, generate, cancel } = useMusicGeneration()
  const [prompt, setPrompt] = useState('')
  const [durationSeconds, setDurationSeconds] = useState(30)
  const [instrumental, setInstrumental] = useState(true)
  const [hasKey, setHasKey] = useState(false)

  // Đọc lại trạng thái khoá mỗi khi tab Cấu hình AI lưu thay đổi.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.settings()
      if (cancelled || !result.ok) return
      const status = result.data.providers.find((item) => item.descriptor.id === PROVIDER_ID)
      setHasKey(Boolean(status?.hasCredential))
    })()
    return () => {
      cancelled = true
    }
  }, [credentialsVersion])

  const busy = state.status === 'queued' || state.status === 'running'

  const handleGenerate = useCallback(() => {
    void generate({
      providerId: PROVIDER_ID,
      model: DEFAULT_MODEL,
      prompt: prompt.trim(),
      durationSeconds,
      parameters: { force_instrumental: instrumental, output_format: 'mp3_44100_128' }
    })
  }, [generate, prompt, durationSeconds, instrumental])

  return (
    <div className="music-generation">
      <p className="field-group__title">{t.musicGen.section}</p>
      <p className="music-panel__hint">{t.musicGen.hint}</p>

      {!hasKey && (
        <div className="notice">
          {t.musicGen.needsKey} <ToolButton label={t.voice.openSettings} onClick={onOpenSettings} />
        </div>
      )}

      <label className="music-generation__field">
        <span className="field-row__label">{t.musicGen.prompt}</span>
        <textarea
          value={prompt}
          rows={2}
          placeholder={t.musicGen.promptPlaceholder}
          aria-label={t.musicGen.prompt}
          disabled={busy}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </label>

      <div className="field-row">
        <span className="field-row__label">{t.musicGen.duration}</span>
        <input
          type="number"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          value={durationSeconds}
          aria-label={t.musicGen.duration}
          disabled={busy}
          onChange={(event) => setDurationSeconds(Number(event.target.value) || MIN_SECONDS)}
        />
      </div>

      <label className="music-panel__check">
        <input
          type="checkbox"
          checked={instrumental}
          disabled={busy}
          onChange={(event) => setInstrumental(event.target.checked)}
        />
        {t.musicGen.instrumental}
      </label>

      <div className="music-panel__actions">
        {busy ? (
          <>
            <ToolButton label={t.musicGen.cancel} variant="danger" onClick={() => void cancel()} />
            <span className="music-panel__hint">{state.stage ?? t.musicGen.generating}</span>
          </>
        ) : (
          <ToolButton
            label={t.musicGen.generate}
            icon={<IconSparkle />}
            variant="primary"
            disabled={
              !hasKey ||
              prompt.trim().length === 0 ||
              durationSeconds < MIN_SECONDS ||
              durationSeconds > MAX_SECONDS
            }
            onClick={handleGenerate}
          />
        )}
      </div>

      {state.error && <div className="notice">{state.error}</div>}
      {state.status === 'succeeded' && state.assetName && (
        <p className="music-panel__hint">
          {interpolate(t.musicGen.done, { name: state.assetName })}
          {state.fromCache ? ` · ${t.musicGen.fromCache}` : ''}
        </p>
      )}

      {/* Nói thẳng mức độ đã kiểm chứng, không để người dùng tự đoán. */}
      <p className="music-panel__hint">{t.musicGen.unverified}</p>
    </div>
  )
}
