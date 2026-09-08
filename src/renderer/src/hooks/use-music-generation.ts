import { useCallback, useEffect, useRef, useState } from 'react'
import type { JobRecord } from '../../../shared/jobs/job-types'
import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import { useEditorStore } from '../state/editor-store'

/**
 * Tạo nhạc nền từ mô tả rồi đưa kết quả vào thư viện.
 *
 * Nhạc tạo ra là ASSET THẬT y hệt file nhập tay (DESCRIPTION §4): kéo lên
 * timeline, cắt, chỉnh âm lượng, hoàn tác đều dùng chung một đường. Không có
 * "asset ảo" chỉ sống trong panel AI.
 */

export interface MusicGenerationState {
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  jobId?: string
  stage?: string
  error?: string
  assetName?: string
  /** Kết quả lấy lại từ lần tạo trước thay vì gọi provider. */
  fromCache?: boolean
}

export interface GenerateMusicOptions {
  providerId: string
  model: string
  prompt: string
  durationSeconds: number
  parameters: Record<string, number | string | boolean>
}

export function useMusicGeneration(): {
  state: MusicGenerationState
  generate(options: GenerateMusicOptions): Promise<void>
  cancel(): Promise<void>
} {
  const [state, setState] = useState<MusicGenerationState>({ status: 'idle' })
  const run = useEditorStore((store) => store.run)
  const jobIdRef = useRef<string | null>(null)
  const pendingPrompt = useRef('')

  const attachAsset = useCallback(
    async (job: JobRecord) => {
      const document = useEditorStore.getState().session?.document
      if (!document) return

      const result = await window.api.ai.attachGeneratedAudio({
        jobId: job.id,
        existingAssets: document.assets,
        prompt: pendingPrompt.current
      })
      if (!result.ok) {
        setState({ status: 'failed', error: result.error })
        return
      }

      const asset: MediaAsset = result.data.asset
      // Nội dung trùng bản đã có thì không thêm lần nữa vào thư viện.
      if (!result.data.alreadyInLibrary) {
        run([{ type: 'asset/add', asset }], 'Thêm nhạc nền vào thư viện')
      }

      setState({
        status: 'succeeded',
        assetName: asset.name,
        fromCache: job.servedFromCache
      })
    },
    [run]
  )

  useEffect(() => {
    return window.api.jobs.onChanged((job) => {
      if (job.id !== jobIdRef.current) return

      if (job.status === 'queued' || job.status === 'running') {
        setState({ status: job.status, jobId: job.id, stage: job.progress.stage })
        return
      }

      jobIdRef.current = null
      if (job.status === 'succeeded') {
        void attachAsset(job)
        return
      }
      setState({ status: job.status, error: job.error?.message })
    })
  }, [attachAsset])

  const generate = useCallback(async (options: GenerateMusicOptions) => {
    const document = useEditorStore.getState().session?.document
    if (!document) return

    pendingPrompt.current = options.prompt
    setState({ status: 'queued' })

    const result = await window.api.music.generate({
      projectId: document.id,
      providerId: options.providerId,
      model: options.model,
      prompt: options.prompt,
      durationSeconds: options.durationSeconds,
      parameters: options.parameters,
      label: options.prompt.slice(0, 40)
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

  return { state, generate, cancel }
}
