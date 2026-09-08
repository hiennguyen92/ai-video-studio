import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobRecord } from '../../../shared/jobs/job-types'
import type { Transcript } from '../../../shared/domain/transcript-types'
import { createId } from '../../../shared/domain/project-document-factory'
import { useEditorStore } from '../state/editor-store'

/**
 * Chạy phiên âm rồi ghi kết quả vào project.
 *
 * Timestamp do engine trả về tính từ đầu ĐOẠN AUDIO ĐÃ TRÍCH. Hook này cộng thêm
 * `sourceInUs` của clip để mọi mốc thời gian quy về hệ toạ độ của ASSET — nhờ vậy
 * transcript vẫn đúng khi clip bị kéo đi chỗ khác hay bị cắt lại.
 */

export interface TranscriptionState {
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  jobId?: string
  progress?: number
  stage?: string
  error?: string
  transcriptId?: string
}

export interface StartTranscriptionOptions {
  assetId: string
  sourcePath: string
  /** Điểm bắt đầu trong asset. */
  sourceInUs: number
  durationUs: number
  providerId: string
  /** Bỏ trống để engine tự nhận diện. */
  language?: string
  label: string
}

export function useTranscription(): {
  state: TranscriptionState
  start(options: StartTranscriptionOptions): Promise<void>
  cancel(): Promise<void>
} {
  const [state, setState] = useState<TranscriptionState>({ status: 'idle' })
  const run = useEditorStore((store) => store.run)
  const pending = useRef<StartTranscriptionOptions | null>(null)
  const jobIdRef = useRef<string | null>(null)

  const applyResult = useCallback(
    async (job: JobRecord) => {
      const options = pending.current
      if (!options) return

      const result = await window.api.stt.readResult(job.id)
      if (!result.ok) {
        setState({ status: 'failed', error: result.error })
        return
      }

      const transcript: Transcript = {
        id: createId('transcript'),
        assetId: options.assetId,
        language: result.data.language,
        languageAutoDetected: result.data.languageAutoDetected,
        providerId: job.providerId,
        model: job.model,
        createdAt: new Date().toISOString(),
        segments: result.data.segments.map((segment) => ({
          id: createId('seg'),
          // Quy về hệ toạ độ của asset: engine đếm từ đầu đoạn đã trích.
          startUs: segment.startUs + options.sourceInUs,
          endUs: segment.endUs + options.sourceInUs,
          text: segment.text,
          words: segment.words?.map((word) => ({
            startUs: word.startUs + options.sourceInUs,
            endUs: word.endUs + options.sourceInUs,
            text: word.text
          })),
          speaker: segment.speaker,
          edited: false
        }))
      }

      const applied = run([{ type: 'transcript/add', transcript }], 'Thêm bản phiên âm')
      setState({
        status: applied ? 'succeeded' : 'failed',
        transcriptId: applied ? transcript.id : undefined
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
          stage: job.progress.stage
        })
        return
      }

      jobIdRef.current = null
      if (job.status === 'succeeded') {
        void applyResult(job)
        return
      }
      setState({ status: job.status, error: job.error?.message })
    })
  }, [applyResult])

  const start = useCallback(async (options: StartTranscriptionOptions) => {
    const document = useEditorStore.getState().session?.document
    if (!document) return

    pending.current = options
    setState({ status: 'queued' })

    const result = await window.api.stt.transcribe({
      projectId: document.id,
      providerId: options.providerId,
      sourcePath: options.sourcePath,
      sourceInUs: options.sourceInUs,
      durationUs: options.durationUs,
      language: options.language,
      label: options.label
    })

    if (!result.ok) {
      setState({ status: 'failed', error: result.error })
      return
    }
    jobIdRef.current = result.data.id
    setState({ status: 'queued', jobId: result.data.id })
  }, [])

  const cancel = useCallback(async () => {
    if (jobIdRef.current) await window.api.jobs.cancel(jobIdRef.current)
  }, [])

  return { state, start, cancel }
}
