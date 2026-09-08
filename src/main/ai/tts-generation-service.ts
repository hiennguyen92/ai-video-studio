import type { JobRecord } from '../../shared/jobs/job-types'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { keepSupportedParameters } from '../../shared/ai/ai-capability-types'
import { getCredential } from '../secrets/credential-store'
import { getProviderConfig } from '../secrets/provider-config-store'
import { jobQueue } from '../jobs/job-queue'
import { computeRequestFingerprint } from '../jobs/job-result-cache'
import { importMediaFile } from '../media/media-import-service'
import { getTtsAdapter } from './provider-registry'

/**
 * Sinh giọng đọc rồi biến kết quả thành asset THẬT trong project.
 *
 * Điểm mấu chốt (DESCRIPTION §4): audio do AI tạo ra không phải là thứ chỉ tồn
 * tại trong panel AI. Nó đi qua đúng đường nhập media như file người dùng tự
 * chọn, nên có thumbnail/waveform, có thời lượng ĐO ĐƯỢC bằng ffprobe, kéo được
 * vào timeline, cắt được và hoàn tác được.
 *
 * Thời lượng luôn là số đo thật, không phải ước lượng theo số ký tự. Mốc 3 sẽ
 * dựa vào con số này để phát hiện đoạn lồng tiếng bị tràn giờ.
 */

export interface SpeechGenerationRequest {
  projectId: string
  providerId: string
  model: string
  voiceId: string
  text: string
  language?: string
  parameters: Record<string, number | string | boolean>
  outputFormat: string
  /** Nhãn hiển thị trong danh sách tác vụ. */
  label: string
  /** Segment của transcript/bản dịch đã sinh ra đoạn này, nếu có. */
  sourceSegmentId?: string
}

export async function enqueueSpeechGeneration(
  request: SpeechGenerationRequest
): Promise<JobRecord> {
  const adapter = getTtsAdapter(request.providerId)
  if (!adapter) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: `Không có adapter cho provider "${request.providerId}".`,
      retryable: false
    })
  }

  const apiKey = await getCredential(request.providerId)
  // Provider tự host có thể chạy không cần xác thực; chỉ chặn khi khoá là bắt buộc.
  if (!apiKey && adapter.descriptor.credentialRequired) {
    throw new ProviderError({
      kind: 'missing-credential',
      providerId: request.providerId,
      message: `Chưa có khoá API cho ${adapter.descriptor.name}. Vào Cấu hình AI để nhập khoá.`,
      retryable: false
    })
  }

  const config = await getProviderConfig(request.providerId)

  // Ô cấu hình bắt buộc mà bỏ trống thì chặn ngay, thay vì để lỗi mạng khó hiểu
  // xuất hiện lúc job đã chạy.
  const missingField = (adapter.descriptor.configFields ?? []).find(
    (field) => field.required && !config[field.key]
  )
  if (missingField) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: `Chưa cấu hình "${missingField.labelVi}" cho ${adapter.descriptor.name}. Vào Cấu hình AI để điền.`,
      retryable: false
    })
  }

  const capabilities = adapter.capabilities(request.model)
  // Bỏ tham số lạ trước khi gửi: preset lưu trong project có thể được tạo từ
  // provider khác hoặc từ phiên bản ứng dụng cũ.
  const parameters = keepSupportedParameters(request.parameters, capabilities.parameters)

  const fingerprint = computeRequestFingerprint({
    task: 'tts',
    providerId: request.providerId,
    model: request.model,
    voiceId: request.voiceId,
    text: request.text,
    language: request.language ?? null,
    parameters,
    outputFormat: request.outputFormat
  })

  return jobQueue.enqueue({
    kind: 'tts',
    projectId: request.projectId,
    label: request.label,
    fingerprint,
    providerId: request.providerId,
    model: request.model,
    resultBaseName: `giong-doc-${Date.now().toString(36)}`,
    handler: async ({ signal }) => {
      const result = await adapter.synthesize(
        { apiKey: apiKey ?? '', config, signal },
        {
          model: request.model,
          voiceId: request.voiceId,
          text: request.text,
          language: request.language,
          parameters,
          outputFormat: request.outputFormat
        }
      )
      return { bytes: result.audio, fileExtension: result.fileExtension }
    }
  })
}

/**
 * Biến file kết quả của job thành asset trong thư viện.
 *
 * Tách khỏi bước sinh audio vì hai việc này thất bại theo cách khác nhau: gọi
 * provider có thể hỏng vì mạng, còn nhập media có thể hỏng vì đĩa. Gộp lại thì
 * một lỗi ffprobe sẽ bị báo nhầm thành lỗi provider.
 */
export async function attachGeneratedAudioAsset(options: {
  jobId: string
  existingAssets: MediaAsset[]
  prompt?: string
  language?: string
  voiceId?: string
  sourceSegmentId?: string
}): Promise<{ asset: MediaAsset; alreadyInLibrary: boolean }> {
  const job = jobQueue.get(options.jobId)
  if (!job) throw new Error(`Không tìm thấy tác vụ ${options.jobId}`)
  if (job.status !== 'succeeded' || !job.resultPath) {
    throw new Error(`Tác vụ ${options.jobId} chưa có kết quả để đưa vào thư viện`)
  }

  const result = await importMediaFile(
    {
      projectId: job.projectId,
      filePath: job.resultPath,
      generated: {
        task: 'tts',
        providerId: job.providerId,
        model: job.model,
        jobId: job.id,
        requestFingerprint: job.fingerprint,
        prompt: options.prompt,
        language: options.language,
        voiceId: options.voiceId,
        sourceSegmentId: options.sourceSegmentId
      }
    },
    options.existingAssets
  )

  return { asset: result.asset, alreadyInLibrary: Boolean(result.duplicateOfAssetId) }
}
