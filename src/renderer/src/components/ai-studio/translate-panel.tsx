import { useCallback, useMemo, useState, type JSX } from 'react'
import type {
  GlossaryEntry,
  Transcript,
  Translation
} from '../../../../shared/domain/transcript-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useTranslationJob } from '../../hooks/use-translation-job'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle, IconTrash } from '../ui/icons'
import { TranslationGlossaryEditor } from './translation-glossary-editor'
import './translate-panel.css'

/**
 * Tab Dịch (DESCRIPTION §3.E).
 *
 * Hiển thị song song gốc và dịch theo TỪNG ĐOẠN, không phải hai khối văn bản
 * rời: người dùng cần thấy đúng câu nào ứng với câu nào để sửa, và mốc thời gian
 * luôn lấy từ đoạn gốc.
 */

const PROVIDER_ID = 'openai-compatible-chat'

const TARGET_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' }
]

/** Ghép đoạn gốc với đoạn dịch tương ứng theo liên kết id. */
function pairSegments(
  transcript: Transcript,
  translation: Translation | undefined
): Array<{
  sourceId: string
  startUs: number
  sourceText: string
  translated?: { id: string; text: string; edited: boolean }
}> {
  const bySource = new Map(
    (translation?.segments ?? []).map((segment) => [segment.sourceSegmentId, segment])
  )

  // Đi theo transcript, không theo bản dịch: thứ tự và mốc thời gian là của bản gốc.
  return transcript.segments.map((segment) => {
    const match = bySource.get(segment.id)
    return {
      sourceId: segment.id,
      startUs: segment.startUs,
      sourceText: segment.text,
      translated: match ? { id: match.id, text: match.text, edited: match.edited } : undefined
    }
  })
}

export function TranslatePanel({ onOpenSettings }: { onOpenSettings(): void }): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)

  const { state: job, start, cancel } = useTranslationJob()
  const [transcriptId, setTranscriptId] = useState<string | null>(null)
  const [targetLanguage, setTargetLanguage] = useState('vi')
  const [draftGlossary, setDraftGlossary] = useState<GlossaryEntry[]>([])

  // Ghi nhớ chính mảng: `?? []` tạo mảng mới mỗi lần dựng lại, khiến mọi useMemo
  // phụ thuộc vào nó tính lại vô ích.
  const transcripts = useMemo(() => document?.transcripts ?? [], [document])
  const transcript = useMemo(
    () => transcripts.find((item) => item.id === transcriptId) ?? transcripts[0],
    [transcripts, transcriptId]
  )

  const translation = useMemo(
    () =>
      transcript
        ? document?.translations.find(
            (item) => item.transcriptId === transcript.id && item.targetLanguage === targetLanguage
          )
        : undefined,
    [document, transcript, targetLanguage]
  )

  // Glossary đang soạn: lấy từ bản dịch đã có, chưa có thì dùng bản nháp cục bộ.
  const glossary = translation?.glossary ?? draftGlossary

  const pairs = useMemo(
    () => (transcript ? pairSegments(transcript, translation) : []),
    [transcript, translation]
  )

  const violatedIds = useMemo(
    () => new Set(job.glossaryViolations.map((violation) => violation.sourceSegmentId)),
    [job.glossaryViolations]
  )

  const busy = job.status === 'queued' || job.status === 'running'

  const handleGlossaryChange = useCallback(
    (next: GlossaryEntry[]) => {
      // Đã có bản dịch thì glossary là dữ liệu của project, phải đi qua lệnh để
      // hoàn tác được; chưa có thì giữ tạm trong panel.
      if (translation) {
        run(
          [{ type: 'translation/set-glossary', translationId: translation.id, glossary: next }],
          'Sửa thuật ngữ'
        )
        return
      }
      setDraftGlossary(next)
    },
    [translation, run]
  )

  const handleStart = useCallback(() => {
    if (!transcript) return
    void start({
      transcript,
      targetLanguage,
      // Bỏ dòng trống người dùng thêm vào rồi chưa điền.
      glossary: glossary.filter((entry) => entry.from.trim() && entry.to.trim()),
      providerId: PROVIDER_ID,
      existingTranslationId: translation?.id
    })
  }, [transcript, targetLanguage, glossary, translation, start])

  if (!transcript) {
    return (
      <div className="translate-panel">
        <EmptyState title={t.translate.noTranscript} hint={t.translate.noTranscriptHint} />
      </div>
    )
  }

  return (
    <div className="translate-panel">
      <p className="field-group__title">{t.translate.providerSection}</p>
      <p className="translate-panel__hint">{t.translate.providerHint}</p>

      <p className="field-group__title">{t.translate.sourceSection}</p>
      <div className="field-row">
        <span className="field-row__label">{t.translate.transcriptLabel}</span>
        <select
          value={transcript.id}
          onChange={(event) => setTranscriptId(event.target.value)}
          aria-label={t.translate.transcriptLabel}
          disabled={busy}
        >
          {transcripts.map((item) => (
            <option key={item.id} value={item.id}>
              {item.language} ·{' '}
              {interpolate(t.translate.segmentCount, { count: item.segments.length })}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.translate.targetLanguage}</span>
        <select
          value={targetLanguage}
          onChange={(event) => setTargetLanguage(event.target.value)}
          aria-label={t.translate.targetLanguage}
          disabled={busy}
        >
          {TARGET_LANGUAGES.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <p className="field-group__title">{t.translate.glossarySection}</p>
      <TranslationGlossaryEditor
        glossary={glossary}
        disabled={busy}
        onChange={handleGlossaryChange}
      />

      <div className="translate-panel__actions">
        {busy ? (
          <>
            <ToolButton label={t.translate.cancel} variant="danger" onClick={() => void cancel()} />
            <span className="translate-panel__hint">
              {job.stage ?? t.translate.running}
              {job.progress !== undefined ? ` · ${Math.round(job.progress * 100)}%` : ''}
            </span>
          </>
        ) : (
          <ToolButton
            label={translation ? t.translate.retranslate : t.translate.start}
            icon={<IconSparkle />}
            variant="primary"
            onClick={handleStart}
          />
        )}
        <ToolButton label={t.voice.openSettings} onClick={onOpenSettings} />
      </div>

      {/* Nói trước hậu quả: dịch lại xoá cả những đoạn đã sửa tay. */}
      {translation && !busy && (
        <p className="translate-panel__hint">{t.translate.retranslateWarning}</p>
      )}
      {job.error && <div className="notice">{job.error}</div>}
      {job.glossaryViolations.length > 0 && (
        <div className="notice">
          {interpolate(t.translate.glossaryViolation, { count: violatedIds.size })}
        </div>
      )}

      <p className="field-group__title">{t.translate.resultSection}</p>
      {!translation ? (
        <EmptyState title={t.translate.noTranslation} hint={t.translate.noTranslationHint} />
      ) : (
        <>
          <div className="translate-columns">
            <span className="translate-columns__head">
              {interpolate(t.translate.sourceColumn, { language: transcript.language })}
            </span>
            <span className="translate-columns__head">
              {interpolate(t.translate.targetColumn, { language: translation.targetLanguage })}
            </span>
          </div>

          <div className="translate-list">
            {pairs.map((pair) => (
              <article
                key={pair.sourceId}
                className={`translate-row ${violatedIds.has(pair.sourceId) ? 'translate-row--violation' : ''}`}
              >
                <div className="translate-row__source">
                  <span className="translate-row__time">{formatClockTime(pair.startUs)}</span>
                  <p className="translate-row__text">{pair.sourceText}</p>
                </div>

                <div className="translate-row__target">
                  <textarea
                    value={pair.translated?.text ?? ''}
                    rows={2}
                    aria-label={`${t.translate.targetColumn.replace('{language}', translation.targetLanguage)} ${pair.sourceId}`}
                    disabled={!pair.translated}
                    onChange={(event) => {
                      if (!pair.translated) return
                      run(
                        [
                          {
                            type: 'translation/update-segment',
                            translationId: translation.id,
                            segmentId: pair.translated.id,
                            text: event.target.value
                          }
                        ],
                        'Sửa bản dịch'
                      )
                    }}
                  />
                  <div className="translate-row__badges">
                    {pair.translated?.edited && (
                      <span className="translate-row__badge">{t.translate.edited}</span>
                    )}
                    {violatedIds.has(pair.sourceId) && (
                      <span className="translate-row__badge translate-row__badge--warn">
                        {t.translate.glossaryViolationBadge}
                      </span>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="translate-panel__actions">
            <ToolButton
              label={t.translate.deleteTranslation}
              icon={<IconTrash />}
              variant="danger"
              onClick={() =>
                run([{ type: 'translation/remove', translationId: translation.id }], 'Xoá bản dịch')
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
