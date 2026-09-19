import { singleSelectedClipId } from '../../../../shared/domain/clip-link-groups'
import {
  STT_SEGMENTATION_MODES,
  type SttSegmentationMode
} from '../../../../shared/ai/stt-segmentation'
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { Transcript } from '../../../../shared/domain/transcript-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { clipEndUs, type Clip } from '../../../../shared/domain/timeline-track-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useWhisperModels, formatBytes } from '../../hooks/use-whisper-models'
import { useTranscription } from '../../hooks/use-transcription'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle, IconTrash } from '../ui/icons'
import './transcribe-panel.css'

/**
 * Tab Phiên âm (DESCRIPTION §3.D).
 *
 * Chạy hoàn toàn trong máy bằng whisper.cpp: không cần khoá API, không tốn phí,
 * audio không rời khỏi máy.
 *
 * Nhấn vào một đoạn transcript sẽ tua preview tới đúng vị trí — mốc thời gian
 * được lưu theo hệ toạ độ của ASSET, nên phải cộng vị trí clip trên timeline mới
 * ra được vị trí cần tua.
 */

/** Nhãn và mô tả của từng cách chia đoạn. */
const SEGMENTATION_LABEL_KEYS = {
  phrase: 'segmentationPhrase',
  sentence: 'segmentationSentence',
  word: 'segmentationWord'
} as const satisfies Record<SttSegmentationMode, string>

const SEGMENTATION_HINT_KEYS = {
  phrase: 'segmentationPhraseHint',
  sentence: 'segmentationSentenceHint',
  word: 'segmentationWordHint'
} as const satisfies Record<SttSegmentationMode, string>

const PROVIDER_ID = 'whisper-cpp'

/**
 * Tìm clip đang chọn cùng asset của nó.
 *
 * Để ngoài component và giữ thuần: vòng lặp có `return` sớm nằm trong `useMemo`
 * khiến bộ biên dịch React không tối ưu hoá được khối đó.
 */
function findSelectedClipWithAsset(
  document: ProjectDocument | null,
  clipIds: string[]
): { clip: Clip; asset: MediaAsset } | null {
  const selectedId = document ? singleSelectedClipId(document, clipIds) : undefined
  if (!document || !selectedId) return null

  for (const track of document.tracks) {
    const clip = track.clips.find((item) => item.id === selectedId)
    if (!clip?.assetId) continue
    const asset = document.assets.find((item) => item.id === clip.assetId)
    if (asset) return { clip, asset }
  }
  return null
}

const LANGUAGES = [
  { code: '', labelKey: 'auto' as const },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' }
]

export function TranscribePanel({
  onOpenSettings,
  credentialsVersion
}: {
  onOpenSettings(): void
  /** Tăng lên mỗi khi tab Cấu hình AI lưu thay đổi, để panel đọc lại đường dẫn model. */
  credentialsVersion: number
}): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const selection = useEditorStore((state) => state.selection)
  const setPlayhead = useEditorStore((state) => state.setPlayhead)
  const setPlaying = useEditorStore((state) => state.setPlaying)
  const run = useEditorStore((state) => state.run)

  const { models, downloads, download, cancelDownload, deleteModel } = useWhisperModels()
  const { state: transcription, start, cancel } = useTranscription()
  const [language, setLanguage] = useState('vi')
  const [segmentation, setSegmentation] = useState<SttSegmentationMode>('phrase')
  const [activeModelPath, setActiveModelPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Clip đang chọn, kèm asset của nó — cần cả hai để quy đổi thời gian. */
  const selected = useMemo(
    () => findSelectedClipWithAsset(document, selection.clipIds),
    [document, selection.clipIds]
  )

  /**
   * Đọc lại đường dẫn model đã lưu trong Cấu hình AI.
   *
   * Người dùng có thể trỏ thẳng tới một file ggml tự tải bằng tay thay vì dùng
   * danh sách tải sẵn ở trên. Không đồng bộ chỗ này thì cấu hình đã lưu vẫn đúng
   * ở tiến trình main nhưng nút "Bắt đầu phiên âm" cứ bị khoá mãi.
   */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.ai.settings()
      if (cancelled || !result.ok) return
      const status = result.data.providers.find((item) => item.descriptor.id === PROVIDER_ID)
      const savedPath = status?.config.modelPath?.trim()
      if (savedPath) setActiveModelPath(savedPath)
    })()
    return () => {
      cancelled = true
    }
  }, [credentialsVersion])

  /** Bản phiên âm của asset đang chọn. */
  const transcript: Transcript | undefined = useMemo(() => {
    if (!document) return undefined
    if (selected) {
      return document.transcripts.find((item) => item.assetId === selected.asset.id)
    }
    return document.transcripts[0]
  }, [document, selected])

  const handleUseModel = useCallback(async (path: string) => {
    setActiveModelPath(path)
    // Ghi vào cấu hình provider để adapter ở tiến trình main dùng đúng model này.
    await window.api.ai.setConfig(PROVIDER_ID, { modelPath: path })
  }, [])

  const handleStart = useCallback(() => {
    if (!selected) return
    if (!activeModelPath) {
      setError(t.transcribe.noModel)
      return
    }
    setError(null)

    void start({
      assetId: selected.asset.id,
      sourcePath: selected.asset.source.path,
      sourceInUs: selected.clip.sourceInUs,
      durationUs: Math.round(selected.clip.durationUs * selected.clip.speed),
      providerId: PROVIDER_ID,
      language: language || undefined,
      segmentation,
      label: `Phiên âm ${selected.asset.name}`
    })
  }, [selected, activeModelPath, language, segmentation, start, t.transcribe.noModel])

  /**
   * Tua preview tới đoạn được nhấn.
   *
   * Segment lưu theo thời gian trong ASSET; vị trí trên timeline = vị trí clip +
   * (thời điểm trong asset - điểm vào của clip), có tính tốc độ phát.
   */
  const seekToSegment = useCallback(
    (segmentStartUs: number) => {
      if (!selected) return
      const offsetInAsset = segmentStartUs - selected.clip.sourceInUs
      const timelineUs = selected.clip.startUs + Math.round(offsetInAsset / selected.clip.speed)
      // Kẹp trong phạm vi clip: đoạn nằm ngoài phần đã cắt thì tua tới mép gần nhất.
      const clamped = Math.max(
        selected.clip.startUs,
        Math.min(timelineUs, clipEndUs(selected.clip) - 1)
      )
      setPlaying(false)
      setPlayhead(clamped)
    },
    [selected, setPlayhead, setPlaying]
  )

  const busy = transcription.status === 'queued' || transcription.status === 'running'

  return (
    <div className="transcribe-panel">
      {/* ── Model ── */}
      <p className="field-group__title">{t.transcribe.modelSection}</p>
      <p className="transcribe-panel__hint">{t.transcribe.modelHint}</p>

      <ul className="model-list">
        {models.map((model) => {
          const progress = downloads[model.id]
          const downloading = progress?.status === 'running'
          const isActive = Boolean(model.path && model.path === activeModelPath)

          return (
            <li key={model.id} className="model-item">
              <div className="model-item__info">
                <span className="model-item__name">{model.labelVi}</span>
                <span className="model-item__meta">
                  {formatBytes(model.approximateBytes)} ·{' '}
                  {interpolate(t.transcribe.qualityLabel, { quality: model.vietnameseQuality })}
                </span>
              </div>

              {downloading && (
                <div className="model-item__progress">
                  <div className="model-item__bar">
                    <div
                      className={`model-item__fill ${progress.ratio === undefined ? 'model-item__fill--indeterminate' : ''}`}
                      style={
                        progress.ratio === undefined
                          ? undefined
                          : { width: `${Math.round(progress.ratio * 100)}%` }
                      }
                    />
                  </div>
                  <span className="model-item__meta">
                    {formatBytes(progress.receivedBytes)}
                    {progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ''}
                  </span>
                </div>
              )}

              <div className="model-item__actions">
                {downloading ? (
                  <ToolButton
                    label={t.transcribe.cancelDownload}
                    variant="danger"
                    onClick={() => void cancelDownload(model.id)}
                  />
                ) : model.downloaded ? (
                  <>
                    <ToolButton
                      label={isActive ? t.transcribe.inUse : t.transcribe.useModel}
                      variant={isActive ? 'ghost' : 'outline'}
                      active={isActive}
                      onClick={() => void handleUseModel(model.path as string)}
                    />
                    <ToolButton
                      label={t.transcribe.deleteModel}
                      icon={<IconTrash />}
                      iconOnly
                      variant="danger"
                      onClick={() => void deleteModel(model.id)}
                    />
                  </>
                ) : (
                  <ToolButton
                    label={t.transcribe.download}
                    variant="outline"
                    onClick={() => void download(model.id)}
                  />
                )}
              </div>

              {progress?.status === 'failed' && (
                <span className="transcribe-panel__error">{progress.error}</span>
              )}
            </li>
          )
        })}
      </ul>

      {activeModelPath && (
        <p className="transcribe-panel__hint">
          {interpolate(t.transcribe.activeModel, {
            name: activeModelPath.split('/').pop() ?? activeModelPath
          })}
        </p>
      )}

      {/* ── Nguồn ── */}
      <p className="field-group__title">{t.transcribe.sourceSection}</p>
      {selected ? (
        <p className="transcribe-panel__hint">
          {interpolate(t.transcribe.selectedClip, { name: selected.asset.name })} ·{' '}
          {formatClockTime(selected.clip.durationUs, false)}
        </p>
      ) : (
        <p className="transcribe-panel__hint">{t.transcribe.selectClipFirst}</p>
      )}

      <div className="field-row">
        <span className="field-row__label">{t.voice.language}</span>
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label={t.voice.language}
          disabled={busy}
        >
          {LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {'labelKey' in option ? t.transcribe.languageAuto : option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.transcribe.segmentation}</span>
        <select
          value={segmentation}
          onChange={(event) => setSegmentation(event.target.value as SttSegmentationMode)}
          aria-label={t.transcribe.segmentation}
          disabled={busy}
        >
          {STT_SEGMENTATION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t.transcribe[SEGMENTATION_LABEL_KEYS[mode]]}
            </option>
          ))}
        </select>
      </div>
      <p className="transcribe-panel__hint">{t.transcribe[SEGMENTATION_HINT_KEYS[segmentation]]}</p>

      <div className="transcribe-panel__actions">
        {busy ? (
          <>
            <ToolButton
              label={t.transcribe.cancel}
              variant="danger"
              onClick={() => void cancel()}
            />
            <span className="transcribe-panel__hint">
              {transcription.stage ?? t.transcribe.running}
              {transcription.progress !== undefined
                ? ` · ${Math.round(transcription.progress * 100)}%`
                : ''}
            </span>
          </>
        ) : (
          <ToolButton
            label={t.transcribe.start}
            icon={<IconSparkle />}
            variant="primary"
            onClick={handleStart}
            disabled={!selected || !activeModelPath}
          />
        )}
        <ToolButton label={t.voice.openSettings} onClick={onOpenSettings} />
      </div>

      {(error || transcription.error) && (
        <div className="notice">{error ?? transcription.error}</div>
      )}

      {/* ── Bản phiên âm ── */}
      <p className="field-group__title">{t.transcribe.transcriptSection}</p>
      {!transcript ? (
        <EmptyState title={t.transcribe.noTranscript} hint={t.transcribe.noTranscriptHint} />
      ) : (
        <>
          <p className="transcribe-panel__hint">
            {interpolate(t.transcribe.segmentCount, {
              count: transcript.segments.length,
              language: transcript.language
            })}
            {' · '}
            {t.transcribe.seekHint}
          </p>

          <div className="transcript-list">
            {transcript.segments.map((segment, index) => (
              <article key={segment.id} className="transcript-segment">
                <button
                  type="button"
                  className="transcript-segment__time"
                  onClick={() => seekToSegment(segment.startUs)}
                  title={t.transcribe.seekHint}
                >
                  {formatClockTime(segment.startUs)}
                </button>

                <textarea
                  className="transcript-segment__text"
                  value={segment.text}
                  rows={2}
                  aria-label={`${t.transcribe.transcriptSection} ${index + 1}`}
                  onChange={(event) =>
                    run(
                      [
                        {
                          type: 'transcript/update-segment',
                          transcriptId: transcript.id,
                          segmentId: segment.id,
                          text: event.target.value
                        }
                      ],
                      'Sửa bản phiên âm'
                    )
                  }
                />

                <div className="transcript-segment__actions">
                  {segment.edited && (
                    <span className="transcript-segment__badge">{t.transcribe.edited}</span>
                  )}
                  {index < transcript.segments.length - 1 && (
                    <ToolButton
                      label={t.transcribe.mergeNext}
                      onClick={() =>
                        run(
                          [
                            {
                              type: 'transcript/merge-segments',
                              transcriptId: transcript.id,
                              segmentId: segment.id
                            }
                          ],
                          'Gộp đoạn phiên âm'
                        )
                      }
                    />
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="transcribe-panel__actions">
            <ToolButton
              label={t.transcribe.deleteTranscript}
              icon={<IconTrash />}
              variant="danger"
              onClick={() =>
                run(
                  [{ type: 'transcript/remove', transcriptId: transcript.id }],
                  'Xoá bản phiên âm'
                )
              }
            />
          </div>
        </>
      )}

      {/* Nói thẳng giới hạn thay vì để người dùng đi tìm nút không tồn tại. */}
      <p className="transcribe-panel__hint">{t.transcribe.diarizationUnsupported}</p>
    </div>
  )
}
