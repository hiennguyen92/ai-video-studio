import type { JobRecord } from '../../shared/jobs/job-types'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { getCredential } from '../secrets/credential-store'
import { getProviderConfig } from '../secrets/provider-config-store'
import { jobQueue } from '../jobs/job-queue'
import { computeRequestFingerprint, resultBaseName } from '../jobs/job-result-cache'
import { getMusicAdapter } from './provider-registry'

/**
 * Sinh nhạc nền từ mô tả bằng chữ.
 *
 * Đi qua đúng hàng đợi job như giọng đọc, nên được thừa hưởng: huỷ giữa chừng,
 * giới hạn số job chạy song song, và cache theo vân tay yêu cầu — hỏi lại y hệt
 * thì dùng lại kết quả cũ thay vì tính tiền thêm một lần nữa.
 */

export interface MusicGenerationRequest {
  projectId: string
  providerId: string
  model: string
  prompt: string
  durationSeconds: number
  parameters: Record<string, number | string | boolean>
  label: string
}

export async function enqueueMusicGeneration(request: MusicGenerationRequest): Promise<JobRecord> {
  const adapter = getMusicAdapter(request.providerId)
  if (!adapter) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: `Không có adapter sinh nhạc cho "${request.providerId}".`,
      retryable: false
    })
  }

  const apiKey = await getCredential(request.providerId)
  if (!apiKey && adapter.descriptor.credentialRequired) {
    throw new ProviderError({
      kind: 'missing-credential',
      providerId: request.providerId,
      message: `Chưa có khoá API cho ${adapter.descriptor.name}. Vào Cấu hình AI để nhập khoá.`,
      retryable: false
    })
  }

  const config = await getProviderConfig(request.providerId)

  const fingerprint = computeRequestFingerprint({
    task: 'music',
    providerId: request.providerId,
    model: request.model,
    prompt: request.prompt,
    durationSeconds: request.durationSeconds,
    parameters: request.parameters
  })

  return jobQueue.enqueue({
    kind: 'music',
    projectId: request.projectId,
    label: request.label,
    fingerprint,
    providerId: request.providerId,
    model: request.model,
    resultBaseName: resultBaseName('nhac-nen', fingerprint),
    handler: async ({ signal, reportProgress }) => {
      // Provider không báo tiến trình cho việc sinh nhạc, nên hiện sọc chạy vô
      // định thay vì bịa ra phần trăm.
      reportProgress({ indeterminate: true, stage: 'Đang tạo nhạc' })

      const result = await adapter.generate(
        { apiKey: apiKey ?? '', config, signal },
        {
          model: request.model,
          prompt: request.prompt,
          durationSeconds: request.durationSeconds,
          parameters: request.parameters
        }
      )
      return { bytes: result.audio, fileExtension: result.fileExtension }
    }
  })
}
