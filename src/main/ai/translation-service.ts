import type { JobRecord } from '../../shared/jobs/job-types'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type { GlossaryEntry } from '../../shared/domain/transcript-types'
import { getCredential } from '../secrets/credential-store'
import { getProviderConfig } from '../secrets/provider-config-store'
import { jobQueue } from '../jobs/job-queue'
import { computeRequestFingerprint } from '../jobs/job-result-cache'
import { getTranslateAdapter } from './provider-registry'
import { findGlossaryViolations } from './translation-response-parser'

/**
 * Dịch transcript theo từng segment, giữ nguyên liên kết về đoạn gốc.
 *
 * Kết quả trả về LUÔN có đúng số đoạn bằng đầu vào và mang theo `sourceSegmentId`
 * — đó là điều kiện để phụ đề song ngữ và lồng tiếng sau này lấy đúng mốc thời
 * gian. Đoạn nào mô hình không dịch được thì giữ nguyên bản gốc chứ không bỏ đi.
 */

export interface TranslationRequest {
  projectId: string
  providerId: string
  transcriptId: string
  sourceLanguage?: string
  targetLanguage: string
  glossary: GlossaryEntry[]
  segments: Array<{ id: string; text: string }>
  label: string
}

export interface TranslationJobResult {
  sourceLanguage: string
  targetLanguage: string
  model: string
  segments: Array<{ sourceSegmentId: string; text: string }>
  /**
   * Đoạn mà mô hình phớt lờ glossary. Chỉ báo để người dùng tự sửa; không tự
   * thay chuỗi trong bản dịch vì làm vậy dễ tạo câu sai ngữ pháp.
   */
  glossaryViolations: Array<{ sourceSegmentId: string; from: string; to: string }>
}

export async function enqueueTranslation(request: TranslationRequest): Promise<JobRecord> {
  const adapter = getTranslateAdapter(request.providerId)
  if (!adapter) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: `Không có adapter dịch cho "${request.providerId}".`,
      retryable: false
    })
  }
  if (request.segments.length === 0) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: 'Không có đoạn nào để dịch.',
      retryable: false
    })
  }

  const apiKey = await getCredential(request.providerId)
  if (!apiKey && adapter.descriptor.credentialRequired) {
    throw new ProviderError({
      kind: 'missing-credential',
      providerId: request.providerId,
      message: `Chưa có khoá API cho ${adapter.descriptor.name}.`,
      retryable: false
    })
  }

  const config = await getProviderConfig(request.providerId)
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

  const model = config.model?.trim() ?? ''

  const fingerprint = computeRequestFingerprint({
    task: 'translate',
    providerId: request.providerId,
    model,
    transcriptId: request.transcriptId,
    targetLanguage: request.targetLanguage,
    sourceLanguage: request.sourceLanguage ?? null,
    // Sửa glossary hay sửa lời gốc đều phải cho ra kết quả khác, nên cả hai đều
    // nằm trong vân tay.
    glossary: request.glossary,
    segments: request.segments
  })

  return jobQueue.enqueue({
    kind: 'translate',
    projectId: request.projectId,
    label: request.label,
    fingerprint,
    providerId: request.providerId,
    model,
    resultBaseName: `ban-dich-${Date.now().toString(36)}`,
    handler: async ({ signal, reportProgress }) => {
      reportProgress({ indeterminate: true, stage: 'Đang dịch' })

      const result = await adapter.translate(
        {
          apiKey: apiKey ?? '',
          config,
          signal,
          onProgress: (ratio) =>
            reportProgress({ value: ratio, indeterminate: false, stage: 'Đang dịch' })
        },
        {
          model,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          segments: request.segments,
          glossary: request.glossary
        }
      )

      // Ép lại liên kết 1-1 ngay tại đây, không tin vào thứ tự adapter trả về.
      const byId = new Map(result.segments.map((segment) => [segment.id, segment.text]))
      const segments = request.segments.map((segment) => ({
        sourceSegmentId: segment.id,
        text: byId.get(segment.id) ?? segment.text
      }))

      const violations = findGlossaryViolations(
        request.segments.map((segment) => ({
          sourceSegmentId: segment.id,
          sourceText: segment.text,
          translatedText: byId.get(segment.id) ?? ''
        })),
        request.glossary
      )

      const payload: TranslationJobResult = {
        sourceLanguage: request.sourceLanguage ?? '',
        targetLanguage: request.targetLanguage,
        model,
        segments,
        glossaryViolations: violations.map((violation) => ({
          sourceSegmentId: violation.sourceSegmentId,
          from: violation.entry.from,
          to: violation.entry.to
        }))
      }

      return { bytes: new TextEncoder().encode(JSON.stringify(payload)), fileExtension: 'json' }
    }
  })
}

/** Đọc kết quả dịch mà job đã ghi ra đĩa. */
export async function readTranslationResult(jobId: string): Promise<TranslationJobResult> {
  const job = jobQueue.get(jobId)
  if (!job) throw new Error(`Không tìm thấy tác vụ ${jobId}`)
  if (job.status !== 'succeeded' || !job.resultPath) {
    throw new Error(`Tác vụ ${jobId} chưa có kết quả dịch`)
  }

  const { readFile } = await import('node:fs/promises')
  return JSON.parse(await readFile(job.resultPath, 'utf8')) as TranslationJobResult
}
