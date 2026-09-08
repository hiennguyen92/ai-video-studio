import { useCallback, useMemo, useState, type JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { SubtitleTrack } from '../../../../shared/domain/subtitle-types'
import { DEFAULT_SUBTITLE_STYLE } from '../../../../shared/domain/subtitle-types'
import {
  buildSubtitleCues,
  findOverlappingCues
} from '../../../../shared/domain/subtitle-cue-builder'
import { createId } from '../../../../shared/domain/project-document-factory'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle, IconTrash } from '../ui/icons'
import { SubtitleStyleControls } from './subtitle-style-controls'
import './subtitles-panel.css'

/**
 * Tab Phụ đề (DESCRIPTION §3.F).
 *
 * Phụ đề ở đây là DỮ LIỆU: cùng một track được preview đọc để vẽ chồng lên hình,
 * được lớp export nung vào video, và xuất ra file SRT. Không có đường nào tự dựng
 * chữ riêng, nên bản xem trước và bản xuất không thể lệch nhau.
 */

/** Gom mọi clip của dự án — cue phải dựng theo clip thật trên timeline. */
function collectClips(
  document: ProjectDocument | null
): ProjectDocument['tracks'][number]['clips'] {
  if (!document) return []
  return document.tracks.flatMap((track) => track.clips)
}

export function SubtitlesPanel(): JSX.Element {
  const t = useT()
  const document = useEditorStore((state) => selectDocument(state))
  const run = useEditorStore((state) => state.run)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)

  const [transcriptId, setTranscriptId] = useState<string | null>(null)
  const [translationId, setTranslationId] = useState<string>('')
  const [bilingual, setBilingual] = useState(false)
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null)

  const transcripts = useMemo(() => document?.transcripts ?? [], [document])
  const transcript = useMemo(
    () => transcripts.find((item) => item.id === transcriptId) ?? transcripts[0],
    [transcripts, transcriptId]
  )

  // Chỉ bản dịch của chính transcript đang chọn mới ghép được theo id đoạn.
  const translations = useMemo(
    () => (document?.translations ?? []).filter((item) => item.transcriptId === transcript?.id),
    [document, transcript]
  )
  const translation = translations.find((item) => item.id === translationId)

  const subtitleTracks = useMemo(() => document?.subtitleTracks ?? [], [document])
  const track: SubtitleTrack | undefined =
    subtitleTracks.find((item) => item.id === activeTrackId) ?? subtitleTracks[0]

  const clips = useMemo(() => collectClips(document), [document])
  const hasClipForTranscript = transcript
    ? clips.some((clip) => clip.assetId === transcript.assetId)
    : false

  const overlaps = useMemo(() => (track ? findOverlappingCues(track.cues) : []), [track])

  /** Dựng cue từ nguồn đang chọn. Dùng cho cả lúc tạo mới lẫn lúc dựng lại. */
  const buildCues = useCallback(() => {
    if (!transcript) return []
    return buildSubtitleCues({
      transcript,
      translation,
      clips,
      bilingual,
      makeId: () => createId('cue')
    })
  }, [transcript, translation, clips, bilingual])

  const handleCreate = useCallback(() => {
    if (!transcript) return
    const newTrack: SubtitleTrack = {
      id: createId('sub'),
      name: translation ? `Phụ đề ${translation.targetLanguage}` : `Phụ đề ${transcript.language}`,
      language: translation?.targetLanguage ?? transcript.language,
      secondaryLanguage: bilingual && translation ? transcript.language : undefined,
      source: translation
        ? { kind: 'translation', refId: translation.id }
        : { kind: 'transcript', refId: transcript.id },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: buildCues()
    }

    // Tạo mỗi bản phụ đề thôi thì KHÔNG có gì hiện ra: preview và lớp export chỉ
    // vẽ phụ đề khi có một lane trên timeline trỏ tới nó. Vì vậy nếu chưa có lane
    // nào rảnh thì tạo luôn một lane trong CÙNG một giao dịch — một lần hoàn tác
    // xoá sạch cả hai, không để lại lane mồ côi.
    const commands: Parameters<typeof run>[0] = [{ type: 'subtitle/add-track', track: newTrack }]
    const existingLane = (document?.tracks ?? []).find(
      (item) => item.kind === 'subtitle' && !item.subtitleTrackId
    )
    if (existingLane) {
      commands.push({
        type: 'track/update',
        trackId: existingLane.id,
        patch: { subtitleTrackId: newTrack.id }
      })
    } else {
      commands.push({
        type: 'track/add',
        kind: 'subtitle',
        name: newTrack.name,
        subtitleTrackId: newTrack.id
      })
    }

    if (run(commands, 'Tạo track phụ đề')) {
      setActiveTrackId(newTrack.id)
    }
  }, [transcript, translation, bilingual, buildCues, run, document])

  const seekToCue = useCallback(
    (startUs: number) => {
      setPlaying(false)
      // Cue đã ở hệ toạ độ timeline nên tua thẳng, không phải quy đổi gì thêm.
      setPlayhead(startUs)
    },
    [setPlayhead, setPlaying]
  )

  if (!transcript) {
    return (
      <div className="subtitles-panel">
        <EmptyState title={t.subtitles.noTranscript} hint={t.subtitles.noTranscriptHint} />
      </div>
    )
  }

  return (
    <div className="subtitles-panel">
      <p className="field-group__title">{t.subtitles.createSection}</p>
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

      {/* Không có clip nào dùng asset đó thì không có mốc timeline nào để gắn cue. */}
      {!hasClipForTranscript && <div className="notice">{t.subtitles.noClipHint}</div>}

      <div className="subtitles-panel__actions">
        <ToolButton
          label={t.subtitles.create}
          icon={<IconSparkle />}
          variant="primary"
          disabled={!hasClipForTranscript}
          onClick={handleCreate}
        />
      </div>

      {!track ? (
        <EmptyState title={t.subtitles.noCues} hint={t.subtitles.createHint} />
      ) : (
        <>
          <p className="field-group__title">{t.subtitles.trackSection}</p>

          {subtitleTracks.length > 1 && (
            <div className="field-row">
              <span className="field-row__label">{t.subtitles.trackSection}</span>
              <select
                value={track.id}
                onChange={(event) => setActiveTrackId(event.target.value)}
                aria-label={t.subtitles.trackSection}
              >
                {subtitleTracks.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field-row">
            <span className="field-row__label">{t.subtitles.trackName}</span>
            <input
              type="text"
              value={track.name}
              aria-label={t.subtitles.trackName}
              onChange={(event) =>
                run(
                  [
                    {
                      type: 'subtitle/rename-track',
                      trackId: track.id,
                      name: event.target.value || track.name
                    }
                  ],
                  'Đổi tên track phụ đề'
                )
              }
            />
          </div>

          <p className="field-group__title">{t.subtitles.styleSection}</p>
          <SubtitleStyleControls
            style={track.style}
            onChange={(style) =>
              run([{ type: 'subtitle/set-style', trackId: track.id, style }], 'Đổi kiểu phụ đề')
            }
          />

          <div className="subtitles-panel__actions">
            <ToolButton
              label={t.subtitles.rebuild}
              variant="outline"
              disabled={!hasClipForTranscript}
              onClick={() =>
                run(
                  [{ type: 'subtitle/replace-cues', trackId: track.id, cues: buildCues() }],
                  'Dựng lại phụ đề'
                )
              }
            />
            <ToolButton
              label={t.subtitles.deleteTrack}
              icon={<IconTrash />}
              variant="danger"
              onClick={() =>
                run([{ type: 'subtitle/remove-track', trackId: track.id }], 'Xoá track phụ đề')
              }
            />
          </div>
          <p className="subtitles-panel__hint">{t.subtitles.rebuildWarning}</p>

          {overlaps.length > 0 && (
            <div className="notice">
              {interpolate(t.subtitles.overlapWarning, { count: overlaps.length })}
            </div>
          )}

          <p className="field-group__title">
            {interpolate(t.subtitles.cueCount, { count: track.cues.length })}
          </p>
          <p className="subtitles-panel__hint">{t.subtitles.seekHint}</p>

          <div className="cue-list">
            {track.cues.map((cue, index) => (
              <article key={cue.id} className="cue-row">
                <button
                  type="button"
                  className="cue-row__time"
                  onClick={() => seekToCue(cue.startUs)}
                  title={t.subtitles.seekHint}
                >
                  {formatClockTime(cue.startUs)}
                </button>

                <div className="cue-row__body">
                  <textarea
                    className="cue-row__text"
                    value={cue.text}
                    rows={2}
                    aria-label={`${t.subtitles.cuesSection} ${index + 1}`}
                    onChange={(event) =>
                      run(
                        [
                          {
                            type: 'subtitle/update-cue',
                            trackId: track.id,
                            cueId: cue.id,
                            text: event.target.value
                          }
                        ],
                        'Sửa phụ đề'
                      )
                    }
                  />
                  {cue.textSecondary !== undefined && (
                    <textarea
                      className="cue-row__text cue-row__text--secondary"
                      value={cue.textSecondary}
                      rows={1}
                      aria-label={`${t.subtitles.secondaryLine} ${index + 1}`}
                      onChange={(event) =>
                        run(
                          [
                            {
                              type: 'subtitle/update-cue',
                              trackId: track.id,
                              cueId: cue.id,
                              textSecondary: event.target.value
                            }
                          ],
                          'Sửa phụ đề'
                        )
                      }
                    />
                  )}
                </div>

                <div className="cue-row__actions">
                  {cue.edited && <span className="cue-row__badge">{t.subtitles.edited}</span>}
                  <ToolButton
                    label={t.subtitles.removeCue}
                    icon={<IconTrash />}
                    iconOnly
                    variant="danger"
                    onClick={() =>
                      run(
                        [{ type: 'subtitle/remove-cue', trackId: track.id, cueId: cue.id }],
                        'Xoá cue'
                      )
                    }
                  />
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
