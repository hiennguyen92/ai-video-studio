import { useEffect, useState, type JSX } from 'react'
import { SOUND_EFFECTS } from '../../../../shared/domain/sound-effect-catalog'
import { findFreeSlot } from '../../../../shared/commands/timeline-mutations'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Hiệu ứng âm thanh dựng sẵn trong app.
 *
 * Không mạng, không tính tiền, không giấy phép phải xét — chúng được tổng hợp
 * bằng ffmpeg lúc build. Bấm một cái là thành asset THẬT trong thư viện, kéo
 * cắt chỉnh hoàn tác đều như file nhập tay (DESCRIPTION §4).
 *
 * Danh mục là hằng số dùng chung với công cụ MCP, nên agent và người dùng nhìn
 * thấy đúng một danh sách.
 */

export function SoundEffectSection(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const playheadUs = useEditorStore((state) => state.playheadUs)
  const [available, setAvailable] = useState<string[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.soundEffects.list().then((result) => {
      if (cancelled) return
      setAvailable(result.ok ? result.data : [])
    })
    return () => {
      cancelled = true
    }
  }, [])

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
          startUs: findFreeSlot(track.clips, playheadUs, asset.probe.durationUs),
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

  return (
    <div className="sound-effect-section">
      <p className="field-group__title">{t.soundEffects.section}</p>
      <p className="subtitles-panel__hint">{t.soundEffects.hint}</p>

      {available !== null && available.length === 0 && (
        // Thiếu file là lỗi ĐÓNG GÓI, không phải lỗi dữ liệu. Nói ra thay vì bày
        // một danh sách nút bấm vào thì lỗi.
        <div className="notice">{t.soundEffects.missingLibrary}</div>
      )}

      {error && <div className="notice">{error}</div>}

      <div className="sound-effect-list">
        {SOUND_EFFECTS.filter((effect) => available === null || available.includes(effect.id)).map(
          (effect) => (
            <article key={effect.id} className="sound-effect-item">
              <div className="sound-effect-item__body">
                <span className="sound-effect-item__name">{effect.nameVi}</span>
                <span className="sound-effect-item__meta">
                  {Math.round(effect.durationUs / 1000)}ms · {effect.tags.slice(0, 2).join(', ')}
                </span>
              </div>
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
            </article>
          )
        )}
      </div>
    </div>
  )
}
