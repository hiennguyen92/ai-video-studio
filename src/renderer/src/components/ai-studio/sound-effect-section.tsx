import { useEffect, useRef, useState, type JSX } from 'react'
import {
  SOUND_EFFECTS,
  type SoundEffectDefinition,
  type SoundEffectLibraryStatus
} from '../../../../shared/domain/sound-effect-catalog'
import { findFreeSlot } from '../../../../shared/commands/timeline-mutations'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useLocale } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconPlay } from '../ui/icons'
import './sound-effect-section.css'

/**
 * Hiệu ứng âm thanh dựng sẵn trong app.
 *
 * Không mạng, không tính tiền — file nằm sẵn trong `resources/sound-effects/`,
 * được chuẩn hoá độ to lúc build. Bấm một cái là thành asset THẬT trong thư viện, kéo
 * cắt chỉnh hoàn tác đều như file nhập tay (DESCRIPTION §4).
 *
 * Danh mục là hằng số dùng chung với công cụ MCP, nên agent và người dùng nhìn
 * thấy đúng một danh sách.
 */

/** Tên theo ngôn ngữ đang chọn. Danh mục mang sẵn cả hai; lấy cứng một cái là bỏ phí. */
function displayName(effect: SoundEffectDefinition, locale: string): string {
  return locale === 'en' ? effect.nameEn : effect.nameVi
}

export function SoundEffectSection(): JSX.Element {
  const { t, locale } = useLocale()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)

  const [status, setStatus] = useState<SoundEffectLibraryStatus | null>(null)
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const listed = await window.api.soundEffects.list()
      if (cancelled || !listed.ok) return
      setStatus(listed.data)
      if (listed.data.effects.length === 0) return

      // Đăng ký với máy chủ cục bộ để nghe thử: thẻ `<audio>` không đọc được
      // đường dẫn đĩa, đúng lý do mà preview của Remotion cũng phải đi qua đây.
      const registered = await window.api.media.registerLocal(
        listed.data.effects.map((effect) => ({ id: effect.id, path: effect.path }))
      )
      if (!cancelled && registered.ok) setPreviewUrls(registered.data)
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // Rời panel giữa lúc đang nghe thì tiếng phải tắt theo.
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const preview = (id: string): void => {
    const url = previewUrls[id]
    if (!url) return

    // Một thẻ audio dùng lại cho mọi hiệu ứng: bấm cái thứ hai thì cái đầu im,
    // không chồng tiếng lên nhau.
    audioRef.current?.pause()
    const audio = new Audio(url)
    audioRef.current = audio
    setPlayingId(id)
    audio.addEventListener('ended', () =>
      setPlayingId((current) => (current === id ? null : current))
    )
    void audio.play().catch(() => setPlayingId(null))
  }

  const add = async (id: string, toTimeline: boolean): Promise<void> => {
    if (!document) return
    setBusyId(id)
    setError(null)
    try {
      const built = await window.api.soundEffects.buildAsset(id)
      if (!built.ok) {
        setError(built.error)
        return
      }
      const asset = built.data
      const commands: EditorCommand[] = [{ type: 'asset/add', asset }]

      if (toTimeline) {
        const track = document.tracks.find((item) => item.kind === 'audio' && !item.locked)
        if (!track) {
          setError(t.soundEffects.needAudioTrack)
          return
        }
        commands.push({
          type: 'clip/insert',
          trackId: track.id,
          assetId: asset.id,
          // Đặt ở đầu phát, nhưng né clip đang có: đè lên lời thoại là hỏng bản
          // dựng mà không ai để ý ngay.
          startUs: findFreeSlot(
            track.clips,
            useEditorStore.getState().playheadUs,
            asset.probe.durationUs
          ),
          durationUs: asset.probe.durationUs,
          sourceInUs: 0
        })
      }

      // Một lần bấm là MỘT bước hoàn tác, kể cả khi thêm cả asset lẫn clip.
      run(commands, toTimeline ? t.soundEffects.addToTimeline : t.soundEffects.addToLibrary)
    } finally {
      setBusyId(null)
    }
  }

  const available = status?.effects.map((effect) => effect.id) ?? null

  return (
    <div className="sound-effect-section">
      <p className="field-group__title">{t.soundEffects.section}</p>
      <p className="subtitles-panel__hint">{t.soundEffects.hint}</p>

      {status !== null && status.effects.length === 0 && (
        // Thiếu file mang hai nghĩa khác hẳn nhau. Nói nhầm thì người dùng đi tìm
        // một lỗi đóng gói không hề tồn tại.
        <div className="notice">
          {status.packaged ? t.soundEffects.missingLibrary : t.soundEffects.notBuiltYet}
        </div>
      )}

      {error && <div className="notice">{error}</div>}

      <div className="sound-effect-list">
        {SOUND_EFFECTS.filter((effect) => available === null || available.includes(effect.id)).map(
          (effect) => (
            <article key={effect.id} className="sound-effect-item">
              <ToolButton
                label={`${t.soundEffects.preview} ${displayName(effect, locale)}`}
                icon={<IconPlay />}
                iconOnly
                active={playingId === effect.id}
                disabled={!previewUrls[effect.id]}
                onClick={() => preview(effect.id)}
              />
              <div className="sound-effect-item__body">
                <span className="sound-effect-item__name">{displayName(effect, locale)}</span>
                <span className="sound-effect-item__meta">
                  {Math.round(effect.durationUs / 1000)}ms · {effect.tags.slice(0, 2).join(', ')}
                </span>
              </div>
              <div className="sound-effect-item__actions">
                <ToolButton
                  label={t.soundEffects.addToTimeline}
                  disabled={busyId !== null}
                  onClick={() => void add(effect.id, true)}
                />
                <ToolButton
                  label={t.soundEffects.addToLibrary}
                  variant="outline"
                  disabled={busyId !== null}
                  onClick={() => void add(effect.id, false)}
                />
              </div>
            </article>
          )
        )}
      </div>
    </div>
  )
}
