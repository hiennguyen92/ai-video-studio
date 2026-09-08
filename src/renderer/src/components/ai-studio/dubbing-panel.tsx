import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type {
  DubbingOverflowStrategy,
  DubbingSegment,
  DubbingSession
} from '../../../../shared/domain/transcript-types'
import { DEFAULT_MAX_DUBBING_SPEED_UP } from '../../../../shared/domain/transcript-types'
import {
  planDubbingPlacement,
  planSegmentOverflow,
  totalTimelineExtensionUs
} from '../../../../shared/domain/dubbing-overflow-planner'
import { createId } from '../../../../shared/domain/project-document-factory'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useSpeechGeneration } from '../../hooks/use-speech-generation'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconSparkle, IconTrash } from '../ui/icons'
import { DubbingSegmentRow } from './dubbing-segment-row'
import './dubbing-panel.css'

/**
 * Lồng tiếng theo bản dịch (DESCRIPTION §3.E).
 *
 * Quy tắc không được phá: audio đã tạo KHÔNG bao giờ bị cắt ngắn để ép cho vừa
 * khoảng thời gian gốc. Panel này đo thời lượng thật của từng đoạn rồi đưa ra ba
 * lối thoát — tăng tốc trong giới hạn, rút ngắn lời, hoặc kéo dài timeline — và
 * để người dùng chọn.
 */

export interface DubbingVoiceSettings {
  providerId: string
  model: string
  voiceId: string
  language?: string
  parameters: Record<string, number | string | boolean>
  outputFormat: string
}

export function DubbingPanel({ voice }: { voice: DubbingVoiceSettings | null }): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)
  const { states, generate } = useSpeechGeneration()

  const [translationId, setTranslationId] = useState<string>('')
  const [textOverrides, setTextOverrides] = useState<Record<string, string>>({})

  const translations = useMemo(() => document?.translations ?? [], [document])
  const translation = translations.find((item) => item.id === translationId) ?? translations[0]

  const session: DubbingSession | undefined = useMemo(
    () => document?.dubbingSessions.find((item) => item.sourceId === translation?.id),
    [document, translation]
  )

  /** Lời để đọc: ưu tiên bản người dùng vừa rút ngắn, chưa sửa thì lấy bản dịch. */
  const textFor = useCallback(
    (sourceSegmentId: string): string =>
      textOverrides[sourceSegmentId] ??
      translation?.segments.find((item) => item.sourceSegmentId === sourceSegmentId)?.text ??
      '',
    [textOverrides, translation]
  )

  /**
   * Ghi thời lượng ĐO ĐƯỢC vào phiên khi một đoạn đọc xong.
   *
   * Con số này lấy từ asset đã import — ffprobe đo file thật, không phải ước
   * lượng theo số ký tự. Mọi tính toán tràn giờ đều dựa vào nó.
   */
  useEffect(() => {
    if (!session || !document) return

    for (const segment of session.segments) {
      const state = states[segment.id]
      if (state?.status !== 'succeeded' || !state.assetId) continue
      if (segment.assetId === state.assetId && segment.generatedDurationUs !== undefined) continue

      const asset = document.assets.find((item) => item.id === state.assetId)
      if (!asset) continue

      run(
        [
          {
            type: 'dubbing/update-segment',
            sessionId: session.id,
            segmentId: segment.id,
            assetId: asset.id,
            generatedDurationUs: asset.probe.durationUs,
            status: 'ready'
          }
        ],
        'Ghi thời lượng lồng tiếng'
      )
    }
  }, [states, session, document, run])

  const handleCreate = useCallback(() => {
    if (!translation || !voice) return

    const transcript = document?.transcripts.find((item) => item.id === translation.transcriptId)
    if (!transcript) return

    // Khoảng thời gian mục tiêu lấy từ đoạn GỐC: bản dịch không giữ mốc riêng.
    const segments: DubbingSegment[] = translation.segments.flatMap((translated) => {
      const source = transcript.segments.find((item) => item.id === translated.sourceSegmentId)
      if (!source) return []
      return [
        {
          id: createId('dub'),
          sourceSegmentId: translated.sourceSegmentId,
          targetStartUs: source.startUs,
          targetEndUs: source.endUs,
          appliedSpeed: 1,
          status: 'pending' as const
        }
      ]
    })

    const newSession: DubbingSession = {
      id: createId('dubses'),
      sourceKind: 'translation',
      sourceId: translation.id,
      language: translation.targetLanguage,
      providerId: voice.providerId,
      model: voice.model,
      voiceId: voice.voiceId,
      maxSpeedUp: DEFAULT_MAX_DUBBING_SPEED_UP,
      createdAt: new Date().toISOString(),
      segments
    }

    run([{ type: 'dubbing/add-session', session: newSession }], 'Chuẩn bị lồng tiếng')
  }, [translation, voice, document, run])

  const generateSegment = useCallback(
    (segment: DubbingSegment) => {
      if (!voice) return
      void generate({
        segmentId: segment.id,
        text: textFor(segment.sourceSegmentId),
        providerId: voice.providerId,
        model: voice.model,
        voiceId: voice.voiceId,
        language: voice.language,
        parameters: voice.parameters,
        outputFormat: voice.outputFormat
      })
    },
    [voice, generate, textFor]
  )

  /** Chèn từng đoạn lên track lồng tiếng theo đúng vị trí đã tính. */
  const applyToTimeline = useCallback(() => {
    if (!session || !document) return

    const voiceTrack =
      document.tracks.find((item) => item.kind === 'audio' && item.role === 'voiceover') ??
      document.tracks.find((item) => item.kind === 'audio')
    if (!voiceTrack) return

    const placed = planDubbingPlacement(session.segments, session.maxSpeedUp)
    const commands = placed.flatMap((placement) => {
      const segment = session.segments.find((item) => item.id === placement.segmentId)
      if (!segment?.assetId) return []
      const durationUs = placement.endUs - placement.startUs
      if (durationUs <= 0) return []

      return [
        {
          type: 'clip/insert' as const,
          trackId: voiceTrack.id,
          assetId: segment.assetId,
          startUs: placement.startUs,
          durationUs,
          sourceInUs: 0
        }
      ]
    })

    if (commands.length > 0) run(commands, 'Đưa lồng tiếng lên timeline')
  }, [session, document, run])

  const plans = useMemo(
    () =>
      session
        ? session.segments.map((segment) => planSegmentOverflow(segment, session.maxSpeedUp))
        : [],
    [session]
  )
  const overflowCount = plans.filter((plan) => plan.overflowUs > 0).length
  const unresolvedCount = session
    ? session.segments.filter(
        (segment, index) => plans[index]?.overflowUs > 0 && !segment.overflowStrategy
      ).length
    : 0
  const extensionUs = session ? totalTimelineExtensionUs(session.segments, session.maxSpeedUp) : 0
  const anyBusy = Object.values(states).some(
    (state) => state.status === 'queued' || state.status === 'running'
  )

  if (translations.length === 0) {
    return (
      <div className="dubbing-panel">
        <p className="field-group__title">{t.dubbing.section}</p>
        <EmptyState title={t.dubbing.noTranslation} hint={t.dubbing.noTranslationHint} />
      </div>
    )
  }

  return (
    <div className="dubbing-panel">
      <p className="field-group__title">{t.dubbing.section}</p>
      <p className="dubbing-panel__hint">{t.dubbing.hint}</p>

      <div className="field-row">
        <span className="field-row__label">{t.dubbing.source}</span>
        <select
          value={translation?.id ?? ''}
          onChange={(event) => setTranslationId(event.target.value)}
          aria-label={t.dubbing.source}
        >
          {translations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.targetLanguage}
            </option>
          ))}
        </select>
      </div>

      {!session ? (
        <div className="dubbing-panel__actions">
          <ToolButton
            label={t.dubbing.create}
            icon={<IconSparkle />}
            variant="primary"
            // Cần biết dùng giọng nào trước khi tạo phiên.
            disabled={!voice}
            onClick={handleCreate}
          />
        </div>
      ) : (
        <>
          <div className="dubbing-panel__actions">
            <ToolButton
              label={t.dubbing.generateAll}
              icon={<IconSparkle />}
              variant="primary"
              disabled={!voice || anyBusy}
              onClick={() => session.segments.forEach(generateSegment)}
            />
            <ToolButton
              label={t.dubbing.deleteSession}
              icon={<IconTrash />}
              variant="danger"
              onClick={() =>
                run(
                  [{ type: 'dubbing/remove-session', sessionId: session.id }],
                  'Xoá phiên lồng tiếng'
                )
              }
            />
          </div>

          {overflowCount > 0 && (
            <div className="notice">
              {interpolate(t.dubbing.overflowCount, { count: overflowCount })}{' '}
              {t.dubbing.neverTruncate}
            </div>
          )}

          <div className="dubbing-list">
            {session.segments.map((segment, index) => (
              <DubbingSegmentRow
                key={segment.id}
                index={index}
                segment={segment}
                text={textFor(segment.sourceSegmentId)}
                plan={plans[index]}
                maxSpeedUp={session.maxSpeedUp}
                busy={anyBusy}
                onGenerate={() => generateSegment(segment)}
                onEditText={(next) =>
                  setTextOverrides((current) => ({
                    ...current,
                    [segment.sourceSegmentId]: next
                  }))
                }
                onChooseStrategy={(strategy: DubbingOverflowStrategy | undefined) =>
                  run(
                    [
                      {
                        type: 'dubbing/set-overflow-strategy',
                        sessionId: session.id,
                        segmentId: segment.id,
                        strategy
                      }
                    ],
                    'Chọn cách xử lý tràn giờ'
                  )
                }
              />
            ))}
          </div>

          {unresolvedCount > 0 && (
            <div className="notice">
              {interpolate(t.dubbing.unresolved, { count: unresolvedCount })}
            </div>
          )}
          {extensionUs > 0 && (
            <p className="dubbing-panel__hint">
              {interpolate(t.dubbing.extendedBy, {
                duration: formatClockTime(extensionUs, true)
              })}
            </p>
          )}

          <div className="dubbing-panel__actions">
            <ToolButton
              label={t.dubbing.applyToTimeline}
              variant="outline"
              onClick={applyToTimeline}
            />
          </div>
          <p className="dubbing-panel__hint">{t.dubbing.applyHint}</p>
        </>
      )}
    </div>
  )
}
