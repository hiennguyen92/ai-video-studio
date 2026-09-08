import { useCallback, useMemo, useState, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useMediaImport } from '../../hooks/use-media-import'
import { useAudioInsertion, type InsertMode } from '../../hooks/use-audio-insertion'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconImport, IconWaveform } from '../ui/icons'
import { AutoDuckingSection } from './auto-ducking-section'
import { MusicGenerationSection } from './music-generation-section'
import './music-panel.css'

/**
 * Tab Nhạc nền (DESCRIPTION §3.C).
 *
 * Phần này KHÔNG cần provider AI nào: tải nhạc lên, chèn vào track nhạc, chỉnh
 * âm lượng và fade đều là thao tác cục bộ. Vì vậy nó dùng được ngay cả khi chưa
 * nhập khoá API — đúng yêu cầu "Các thao tác chỉnh sửa local vẫn sử dụng được"
 * của DESCRIPTION §3.G.
 *
 * Âm lượng và fade của clip đã chèn được chỉnh trong Inspector, không nhân đôi
 * ô điều khiển ở đây; panel chỉ nhắc người dùng chọn clip.
 */
export function MusicPanel({
  onOpenSettings,
  credentialsVersion
}: {
  onOpenSettings(): void
  credentialsVersion: number
}): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const selection = useEditorStore((state) => state.selection)
  const { importing, pickAndImport } = useMediaImport()
  const { insertAudio } = useAudioInsertion()
  const [insertMode, setInsertMode] = useState<InsertMode>('playhead')
  const [notice, setNotice] = useState<string | null>(null)

  // Nhạc nền là mọi asset âm thanh trong thư viện; người dùng tự quyết dùng cái nào.
  const audioAssets = useMemo(
    () => (document?.assets ?? []).filter((asset) => asset.kind === 'audio'),
    [document?.assets]
  )

  const handleInsert = useCallback(
    (asset: MediaAsset) => {
      const inserted = insertAudio({
        assetIds: [asset.id],
        mode: insertMode,
        role: 'music',
        newTrackName: 'Nhạc nền'
      })
      if (inserted) setNotice(interpolate(t.media.importedOne, { name: asset.name }))
    },
    [insertAudio, insertMode, t.media.importedOne]
  )

  const hasMusicClipSelected = Boolean(
    selection.clipIds.length === 1 &&
    document?.tracks.some(
      (track) =>
        track.kind === 'audio' && track.clips.some((clip) => clip.id === selection.clipIds[0])
    )
  )

  return (
    <div className="music-panel">
      <div className="music-panel__toolbar">
        <ToolButton
          label={t.music.upload}
          icon={<IconImport />}
          variant="outline"
          onClick={() => void pickAndImport()}
          disabled={importing}
        />
        <select
          value={insertMode}
          onChange={(event) => setInsertMode(event.target.value as InsertMode)}
          aria-label={t.music.insert}
        >
          <option value="playhead">{t.music.insertAtPlayhead}</option>
          <option value="new-track">{t.voice.insertNewTrack}</option>
        </select>
      </div>

      {notice && <p className="music-panel__notice">{notice}</p>}

      {audioAssets.length === 0 ? (
        <EmptyState
          title={t.music.empty}
          hint={t.music.emptyHint}
          action={
            <ToolButton
              label={t.music.upload}
              icon={<IconImport />}
              variant="primary"
              onClick={() => void pickAndImport()}
              disabled={importing}
            />
          }
        />
      ) : (
        <ul className="music-panel__list">
          {audioAssets.map((asset) => (
            <li key={asset.id} className="music-item">
              <div className="music-item__info">
                <span className="music-item__name" title={asset.name}>
                  <IconWaveform />
                  {asset.name}
                </span>
                <span className="music-item__meta">
                  {formatClockTime(asset.probe.durationUs, false)}
                  {asset.origin === 'generated' ? ` · ${t.media.generatedBadge}` : ''}
                </span>
              </div>

              <audio
                className="music-item__audio"
                controls
                preload="none"
                src={mediaFileUrl(asset.source.path)}
                aria-label={`${t.voice.listen} ${asset.name}`}
              />

              <ToolButton
                label={t.music.insert}
                variant="outline"
                onClick={() => handleInsert(asset)}
                disabled={asset.missing}
              />
            </li>
          ))}
        </ul>
      )}

      <p className="field-group__title">{t.music.volume}</p>
      <p className="music-panel__hint">
        {hasMusicClipSelected ? t.inspector.noSelectionHint : t.music.selectClipFirst}
      </p>

      <AutoDuckingSection />

      <MusicGenerationSection
        onOpenSettings={onOpenSettings}
        credentialsVersion={credentialsVersion}
      />
    </div>
  )
}
