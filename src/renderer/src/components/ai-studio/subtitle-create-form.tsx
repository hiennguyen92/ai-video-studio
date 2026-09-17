import { useMemo, useState, type JSX } from 'react'
import { createId } from '../../../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { buildSubtitleCues } from '../../../../shared/domain/subtitle-cue-builder'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleTrack
} from '../../../../shared/domain/subtitle-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle } from '../ui/icons'
import { ToolButton } from '../ui/tool-button'

/**
 * Tạo một track phụ đề từ bản phiên âm (kèm bản dịch nếu muốn).
 *
 * Tạo bản phụ đề thôi thì KHÔNG hiện gì: preview và bản xuất chỉ vẽ phụ đề khi có
 * lane trên timeline trỏ tới nó. Nên chưa có lane rảnh thì tạo luôn lane trong CÙNG
 * một lệnh — một lần hoàn tác xoá sạch cả hai.
 */
export function SubtitleCreateForm({
  document,
  onCreated
}: {
  document: ProjectDocument
  onCreated(trackId: string): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const [transcriptId, setTranscriptId] = useState<string | null>(null)
  const [translationId, setTranslationId] = useState('')
  const [bilingual, setBilingual] = useState(false)

  const transcripts = document.transcripts
  const transcript = transcripts.find((item) => item.id === transcriptId) ?? transcripts[0]
  // Chỉ bản dịch của chính bản phiên âm đang chọn mới ghép được theo id đoạn.
  const translations = useMemo(
    () => document.translations.filter((item) => item.transcriptId === transcript?.id),
    [document, transcript]
  )
  const translation = translations.find((item) => item.id === translationId)

  if (!transcript) {
    return <EmptyState title={t.subtitles.noTranscript} hint={t.subtitles.noTranscriptHint} />
  }

  const clips = document.tracks.flatMap((item) => item.clips)
  const hasClip = clips.some((clip) => clip.assetId === transcript.assetId)

  const create = (): void => {
    const track: SubtitleTrack = {
      id: createId('sub'),
      name: `Phụ đề ${translation?.targetLanguage ?? transcript.language}`,
      language: translation?.targetLanguage ?? transcript.language,
      secondaryLanguage: bilingual && translation ? transcript.language : undefined,
      source: translation
        ? { kind: 'translation', refId: translation.id }
        : { kind: 'transcript', refId: transcript.id },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: buildSubtitleCues({
        transcript,
        translation,
        clips,
        bilingual,
        makeId: () => createId('cue')
      })
    }
    const commands: Parameters<typeof run>[0] = [{ type: 'subtitle/add-track', track }]
    const freeLane = document.tracks.find(
      (item) => item.kind === 'subtitle' && !item.subtitleTrackId
    )
    commands.push(
      freeLane
        ? { type: 'track/update', trackId: freeLane.id, patch: { subtitleTrackId: track.id } }
        : { type: 'track/add', kind: 'subtitle', name: track.name, subtitleTrackId: track.id }
    )
    if (run(commands, 'Tạo track phụ đề')) onCreated(track.id)
  }

  return (
    <div className="subtitles-panel__card">
      <p className="subtitles-panel__hint">{t.subtitles.createHint}</p>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.sourceTranscript}</span>
        <select
          value={transcript.id}
          onChange={(event) => setTranscriptId(event.target.value)}
          aria-label={t.subtitles.sourceTranscript}
        >
          {transcripts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.language} · {item.segments.length}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.subtitles.sourceTranslation}</span>
        <select
          value={translationId}
          onChange={(event) => setTranslationId(event.target.value)}
          aria-label={t.subtitles.sourceTranslation}
        >
          <option value="">{t.subtitles.translationNone}</option>
          {translations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.targetLanguage}
            </option>
          ))}
        </select>
      </div>

      <label className="subtitles-panel__check">
        <input
          type="checkbox"
          checked={bilingual}
          // Song ngữ chỉ có nghĩa khi có bản dịch để đặt cạnh bản gốc.
          disabled={!translation}
          onChange={(event) => setBilingual(event.target.checked)}
        />
        {t.subtitles.bilingual}
      </label>

      {!hasClip && <div className="notice">{t.subtitles.noClipHint}</div>}

      <div className="subtitles-panel__actions">
        <ToolButton
          label={t.subtitles.create}
          icon={<IconSparkle />}
          variant="primary"
          disabled={!hasClip}
          onClick={create}
        />
      </div>
    </div>
  )
}
