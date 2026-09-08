import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobRecord } from '../../../shared/jobs/job-types'
import type {
  GlossaryEntry,
  Transcript,
  Translation
} from '../../../shared/domain/transcript-types'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from '../state/editor-store'

/**
 * Chạy dịch rồi ghi bản dịch vào project.
 *
 * Bản dịch KHÔNG lưu mốc thời gian riêng: mỗi đoạn chỉ trỏ về `sourceSegmentId`
 * của transcript. Nhờ vậy sửa lại thời gian ở bản gốc là bản dịch theo đúng
 * ngay, không bao giờ có hai nguồn thời gian lệch nhau.
 */

export interface TranslationJobState {
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  jobId?: string
  progress?: number
  stage?: string
  error?: string
  /** Đoạn mà mô hình phớt lờ glossary; hiện cảnh báo chứ không tự sửa. */
  glossaryViolations: Array<{ sourceSegmentId: string; from: string; to: string }>
}

export interface StartTranslationOptions {
  transcript: Transcript
  targetLanguage: string
  glossary: GlossaryEntry[]
  providerId: string
  /** Đã có bản dịch cũ thì thay nội dung, giữ nguyên id để không mất liên kết. */
  existingTranslationId?: string
}

const IDLE: TranslationJobState = { status: 'idle', glossaryViolations: [] }

export function useTranslationJob(): {
  state: TranslationJobState
  start(options: StartTranslationOptions): Promise<void>
  cancel(): Promise<void>
} {
  const [state, setState] = useState<TranslationJobState>(IDLE)
  const run = useEditorStore((store) => store.run)
  const pending = useRef<StartTranslationOptions | null>(null)
  const jobIdRef = useRef<string | null>(null)

  const applyResult = useCallback(
    async (job: JobRecord) => {
      const options = pending.current
      if (!options) return

      const result = await window.api.translate.readResult(job.id)
      if (!result.ok) {
        setState({ status: 'failed', error: result.error, glossaryViolations: [] })
        return
      }

      const translation: Translation = {
        id: options.existingTranslationId ?? createId('trans'),
        transcriptId: options.transcript.id,
        sourceLanguage: result.data.sourceLanguage || options.transcript.language,
        targetLanguage: result.data.targetLanguage,
        providerId: job.providerId,
        model: result.data.model,
        createdAt: new Date().toISOString(),
        glossary: options.glossary,
        segments: result.data.segments.map((segment) => ({
          id: createId('tseg'),
          sourceSegmentId: segment.sourceSegmentId,
          text: segment.text,
          edited: false
        }))
      }

      // Dịch lại thì thay hẳn bản cũ. Gộp trong một giao dịch để hoàn tác một lần
      // là về đúng trạng thái trước khi dịch.
      const commands = options.existingTranslationId
        ? [
            { type: 'translation/remove' as const, translationId: options.existingTranslationId },
            { type: 'translation/add' as const, translation }
          ]
        : [{ type: 'translation/add' as const, translation }]

      const applied = run(commands, 'Thêm bản dịch')
      setState({
        status: applied ? 'succeeded' : 'failed',
        glossaryViolations: result.data.glossaryViolations
      })
    },
    [run]
  )

  useEffect(() => {
    return window.api.jobs.onChanged((job) => {
      if (job.id !== jobIdRef.current) return

      if (job.status === 'queued' || job.status === 'running') {
        setState({
          status: job.status,
          jobId: job.id,
          progress: job.progress.value,
          stage: job.progress.stage,
          glossaryViolations: []
        })
        return
      }

      jobIdRef.current = null
      if (job.status === 'succeeded') {
        void applyResult(job)
        return
      }
      setState({ status: job.status, error: job.error?.message, glossaryViolations: [] })
    })
  }, [applyResult])

  const start = useCallback(async (options: StartTranslationOptions) => {
    const document = useEditorStore.getState().session?.document
    if (!document) return

    pending.current = options
    setState({ status: 'queued', glossaryViolations: [] })

    const result = await window.api.translate.run({
      projectId: document.id,
      providerId: options.providerId,
      transcriptId: options.transcript.id,
      sourceLanguage: options.transcript.language,
      targetLanguage: options.targetLanguage,
      glossary: options.glossary,
      segments: options.transcript.segments.map((segment) => ({
        id: segment.id,
        text: segment.text
      })),
      label: `Dịch sang ${options.targetLanguage}`
    })

    if (!result.ok) {
      setState({ status: 'failed', error: result.error, glossaryViolations: [] })
      return
    }
    jobIdRef.current = result.data.id
    setState({ status: 'queued', jobId: result.data.id, glossaryViolations: [] })
  }, [])

  const cancel = useCallback(async () => {
    if (jobIdRef.current) await window.api.jobs.cancel(jobIdRef.current)
  }, [])

  return { state, start, cancel }
}
