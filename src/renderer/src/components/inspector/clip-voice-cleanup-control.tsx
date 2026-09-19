import { useMemo, useState, type JSX } from 'react'
import { resolveVoiceCleanupTarget } from '../../../../shared/domain/voice-cleanup-planner'
import type { VoiceCleanupStrength } from '../../../../shared/ipc/voice-cleanup-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { cleanVoiceForClip, isCleaningVoice } from '../../state/voice-cleanup-actions'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Nút "Làm sạch giọng nói" trong tab Audio.
 *
 * Nói trước điều sẽ xảy ra với clip HÌNH (thêm tiếng sạch ở lane lời thoại, tắt
 * tiếng gốc): người dùng bấm vào một clip mà thấy một lane mới mọc ra và clip của
 * mình bị tắt tiếng thì sẽ tưởng là lỗi.
 */
export function ClipVoiceCleanupControl({ clipId }: { clipId: string }): JSX.Element | null {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const [strength, setStrength] = useState<VoiceCleanupStrength>('medium')
  // Gắn với clip: inspector giữ nguyên component khi chọn clip khác, nên trạng
  // thái "đang chạy" hay thông báo của clip trước không được hiện sang clip này.
  const [busyClipId, setBusyClipId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ clipId: string; text: string } | null>(null)
  const busy = busyClipId === clipId || isCleaningVoice(clipId)

  const target = useMemo(() => {
    if (!document) return null
    try {
      return resolveVoiceCleanupTarget(document, clipId)
    } catch {
      return null
    }
  }, [document, clipId])

  if (!target) return null

  const apply = async (): Promise<void> => {
    setBusyClipId(clipId)
    setNotice(null)
    const result = await cleanVoiceForClip(clipId, strength, t.voiceCleanup.title)
    setBusyClipId((current) => (current === clipId ? null : current))
    setNotice({ clipId, text: result.ok ? t.voiceCleanup.done : result.error })
  }

  return (
    <>
      <p className="field-group__title">{t.voiceCleanup.title}</p>
      <div className="field-row">
        <span className="field-row__label">{t.voiceCleanup.strength}</span>
        <select
          value={strength}
          aria-label={t.voiceCleanup.strength}
          disabled={busy}
          onChange={(event) => setStrength(event.target.value as VoiceCleanupStrength)}
        >
          <option value="light">{t.voiceCleanup.light}</option>
          <option value="medium">{t.voiceCleanup.medium}</option>
          <option value="strong">{t.voiceCleanup.strong}</option>
        </select>
      </div>
      <p className="inspector__hint">
        {target.mode === 'add-partner'
          ? t.voiceCleanup.hintVideo
          : target.mode === 'swap-partner'
            ? t.voiceCleanup.hintRedo
            : t.voiceCleanup.hintAudio}
      </p>
      <div className="inspector__actions">
        <ToolButton
          label={busy ? t.voiceCleanup.working : t.voiceCleanup.apply}
          variant="outline"
          disabled={busy}
          onClick={() => void apply()}
        />
      </div>
      {notice?.clipId === clipId && (
        <p className="inspector__hint" role="status">
          {notice.text}
        </p>
      )}
    </>
  )
}
