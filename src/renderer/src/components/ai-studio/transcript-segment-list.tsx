import { useState, type JSX } from 'react'
import { formatClockTime } from '../../../../shared/domain/time-units'
import type { Transcript } from '../../../../shared/domain/transcript-types'
import { buildCutFromTranscript } from '../../state/build-cut-actions'
import { useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconScissors, IconTrash } from '../ui/icons'

/**
 * Các đoạn của bản phiên âm: sửa chữ, gộp đoạn, tua tới đoạn — và DỰNG BẢN CUT
 * theo lời: bỏ dấu các đoạn nói hỏng, nói vấp, rồi xếp phần còn lại liền nhau.
 *
 * Mặc định giữ mọi đoạn: việc thường làm là bỏ vài câu hỏng, không phải chọn vài
 * câu hay trong một trăm câu.
 */
export function TranscriptSegmentList({
  transcript,
  cutTrackId,
  onSeek
}: {
  transcript: Transcript
  /** Lane của clip đang chọn, nếu nó phát đúng media của bản phiên âm. */
  cutTrackId: string | undefined
  onSeek(segmentStartUs: number): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  // Id đoạn đã BỎ, không phải đã giữ: đoạn mới sinh ra khi sửa hay gộp tự được giữ.
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const kept = transcript.segments.filter((segment) => !dropped.has(segment.id))
  const toggle = (segmentId: string): void =>
    setDropped((current) => {
      const next = new Set(current)
      if (next.has(segmentId)) next.delete(segmentId)
      else next.add(segmentId)
      return next
    })

  const buildCut = (): void => {
    if (!window.confirm(t.buildCut.replaceWarning)) return
    const result = buildCutFromTranscript(
      transcript.id,
      kept.map((segment) => segment.id),
      cutTrackId,
      t.buildCut.fromTranscriptLabel
    )
    setError(result.ok ? null : result.error)
  }

  return (
    <>
      <div className="transcript-list">
        {transcript.segments.map((segment, index) => (
          <article
            key={segment.id}
            className={`transcript-segment ${dropped.has(segment.id) ? 'transcript-segment--dropped' : ''}`}
          >
            <div className="transcript-segment__head">
              <input
                type="checkbox"
                checked={!dropped.has(segment.id)}
                aria-label={interpolate(t.buildCut.keepSegment, { index: index + 1 })}
                onChange={() => toggle(segment.id)}
              />
              <button
                type="button"
                className="transcript-segment__time"
                onClick={() => onSeek(segment.startUs)}
                title={t.transcribe.seekHint}
              >
                {formatClockTime(segment.startUs)}
              </button>
            </div>

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

      <p className="transcribe-panel__hint">
        {interpolate(t.buildCut.transcriptHint, {
          kept: kept.length,
          total: transcript.segments.length
        })}
      </p>
      {error && <div className="notice">{error}</div>}
      <div className="transcribe-panel__actions">
        <ToolButton
          label={t.buildCut.fromTranscript}
          icon={<IconScissors />}
          variant="primary"
          disabled={kept.length === 0}
          onClick={buildCut}
        />
        <ToolButton
          label={t.transcribe.deleteTranscript}
          icon={<IconTrash />}
          variant="danger"
          onClick={() =>
            run([{ type: 'transcript/remove', transcriptId: transcript.id }], 'Xoá bản phiên âm')
          }
        />
      </div>
    </>
  )
}
