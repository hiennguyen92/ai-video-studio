import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobRecord } from '../../../shared/jobs/job-types'
import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import { useEditorStore } from '../state/editor-store'

/**
 * Sinh giọng đọc cho từng đoạn kịch bản và biến kết quả thành asset thật.
 *
 * Theo dõi job THEO ĐOẠN chứ không theo một job duy nhất, vì DESCRIPTION §3.B
 * yêu cầu tạo lại được từng đoạn riêng lẻ. Mỗi đoạn có trạng thái độc lập, nên
 * tạo lại câu thứ ba không đụng gì tới hai câu đầu.
 */

export interface SegmentGenerationState {
  jobId?: string
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  assetId?: string
  error?: string
  retryable?: boolean
  /** Kết quả lấy lại từ lần tạo trước thay vì gọi provider. */
  fromCache?: boolean
}

export interface GenerateSegmentOptions {
  segmentId: string
  text: string
  providerId: string
  model: string
  voiceId: string
  language?: string
  parameters: Record<string, number | string | boolean>
  outputFormat: string
}

export function useSpeechGeneration(): {
  states: Record<string, SegmentGenerationState>
  generate(options: GenerateSegmentOptions): Promise<void>
  cancel(segmentId: string): Promise<void>
  reset(segmentId: string): void
} {
  const [states, setStates] = useState<Record<string, SegmentGenerationState>>({})
  const run = useEditorStore((state) => state.run)

  /** jobId -> segmentId, để nối sự kiện job về đúng đoạn. */
  const jobToSegment = useRef(new Map<string, string>())
  /** Thông tin cần khi job xong, giữ ngoài state để listener không bị đóng băng giá trị cũ. */
  const pendingMeta = useRef(new Map<string, GenerateSegmentOptions>())

  const setSegmentState = useCallback(
    (segmentId: string, patch: Partial<SegmentGenerationState>) => {
      setStates((current) => ({
        ...current,
        [segmentId]: { ...(current[segmentId] ?? { status: 'idle' }), ...patch }
      }))
    },
    []
  )

  /**
   * Đưa kết quả job vào thư viện.
   *
   * Chạy ở đây chứ không ở tiến trình main vì document là của renderer: main
   * dựng asset rồi trả về, renderer mới là nơi ghi vào project bằng lệnh có
   * kiểm tra dữ liệu.
   */
  const attachAsset = useCallback(
    async (job: JobRecord, segmentId: string) => {
      const document = useEditorStore.getState().session?.document
      if (!document) return

      const meta = pendingMeta.current.get(segmentId)
      const result = await window.api.ai.attachGeneratedAudio({
        jobId: job.id,
        existingAssets: document.assets,
        prompt: meta?.text,
        language: meta?.language,
        voiceId: meta?.voiceId,
        sourceSegmentId: segmentId
      })

      if (!result.ok) {
        setSegmentState(segmentId, { status: 'failed', error: result.error, retryable: true })
        return
      }

      const asset: MediaAsset = result.data.asset
      // Asset trùng nội dung đã có sẵn thì không thêm lần nữa vào document.
      if (!result.data.alreadyInLibrary) {
        run([{ type: 'asset/add', asset }], 'Thêm giọng đọc vào thư viện')
      }

      setSegmentState(segmentId, {
        status: 'succeeded',
        assetId: asset.id,
        fromCache: job.servedFromCache
      })
    },
    [run, setSegmentState]
  )

  useEffect(() => {
    return window.api.jobs.onChanged((job) => {
      const segmentId = jobToSegment.current.get(job.id)
      if (!segmentId) return

      if (job.status === 'queued' || job.status === 'running') {
        setSegmentState(segmentId, { status: job.status, jobId: job.id })
        return
      }

      jobToSegment.current.delete(job.id)

      if (job.status === 'succeeded') {
        void attachAsset(job, segmentId)
        return
      }

      setSegmentState(segmentId, {
        status: job.status,
        error: job.error?.message,
        retryable: job.error?.retryable ?? true
      })
    })
  }, [attachAsset, setSegmentState])

  const generate = useCallback(
    async (options: GenerateSegmentOptions) => {
      const document = useEditorStore.getState().session?.document
      if (!document) return

      setSegmentState(options.segmentId, {
        status: 'queued',
        error: undefined,
        assetId: undefined,
        fromCache: undefined
      })
      pendingMeta.current.set(options.segmentId, options)

      const result = await window.api.ai.generateSpeech({
        projectId: document.id,
        providerId: options.providerId,
        model: options.model,
        voiceId: options.voiceId,
        text: options.text,
        language: options.language,
        parameters: options.parameters,
        outputFormat: options.outputFormat,
        label: options.text.slice(0, 40),
        sourceSegmentId: options.segmentId
      })

      if (!result.ok) {
        setSegmentState(options.segmentId, {
          status: 'failed',
          error: result.error,
          // Thiếu khoá API thì thử lại vô ích cho tới khi người dùng nhập khoá.
          retryable: !result.error.includes('khoá API')
        })
        return
      }

      jobToSegment.current.set(result.data.id, options.segmentId)
      setSegmentState(options.segmentId, { status: 'queued', jobId: result.data.id })
    },
    [setSegmentState]
  )

  const cancel = useCallback(
    async (segmentId: string) => {
      const jobId = states[segmentId]?.jobId
      if (!jobId) return
      await window.api.jobs.cancel(jobId)
    },
    [states]
  )

  const reset = useCallback((segmentId: string) => {
    setStates((current) => {
      const next = { ...current }
      delete next[segmentId]
      return next
    })
  }, [])

  return { states, generate, cancel, reset }
}
