import type { SttSegmentationMode } from '../../shared/ai/stt-segmentation'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import type { JobRecord } from '../../shared/jobs/job-types'
import type { SttSegment } from '../../shared/ai/ai-provider-contracts'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type { Micros } from '../../shared/domain/time-units'
import { getCredential } from '../secrets/credential-store'
import { getProviderConfig } from '../secrets/provider-config-store'
import { jobQueue } from '../jobs/job-queue'
import { computeRequestFingerprint, resultBaseName } from '../jobs/job-result-cache'
import { extractAudioForTranscription } from '../media/audio-extraction'
import { projectPaths } from '../storage/workspace-paths'
import { getSttAdapter } from './provider-registry'

/**
 * Phiên âm một đoạn media thành transcript có timestamp.
 *
 * Hai bước tách bạch: trích audio bằng ffmpeg, rồi đưa cho engine nhận dạng. Gộp
 * lại thì một lỗi định dạng audio sẽ bị báo nhầm thành lỗi của engine.
 *
 * Timestamp trả về tính từ ĐẦU ĐOẠN AUDIO ĐÃ TRÍCH. Nơi gọi phải cộng thêm vị
 * trí của đoạn đó trên timeline — việc này để ở lớp trên vì chỉ nơi đó biết
 * người dùng đang phiên âm clip nào.
 */

export interface TranscriptionRequest {
  projectId: string
  providerId: string
  /** File nguồn cần phiên âm. */
  sourcePath: string
  /** Điểm bắt đầu trong file nguồn. */
  sourceInUs: Micros
  durationUs: Micros
  /** Bỏ trống để engine tự nhận diện ngôn ngữ. */
  language?: string
  /** Cách chia đoạn; bỏ trống = cụm ngắn. */
  segmentation?: SttSegmentationMode
  label: string
}

/** Kết quả phiên âm được ghi ra đĩa dưới dạng JSON để job cache lại được. */
export interface TranscriptionJobResult {
  language: string
  languageAutoDetected: boolean
  segments: SttSegment[]
}

export async function enqueueTranscription(request: TranscriptionRequest): Promise<JobRecord> {
  const adapter = getSttAdapter(request.providerId)
  if (!adapter) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: request.providerId,
      message: `Không có adapter phiên âm cho "${request.providerId}".`,
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

  const fingerprint = computeRequestFingerprint({
    task: 'stt',
    providerId: request.providerId,
    // Model là đường dẫn file với whisper.cpp; đổi model thì kết quả khác nên
    // phải nằm trong vân tay.
    model: config.modelPath ?? '',
    sourcePath: request.sourcePath,
    sourceInUs: request.sourceInUs,
    durationUs: request.durationUs,
    language: request.language ?? null,
    // Cùng file, cùng model mà chia đoạn khác thì kết quả khác: phải vào vân tay.
    segmentation: request.segmentation ?? 'phrase'
  })

  return jobQueue.enqueue({
    kind: 'stt',
    projectId: request.projectId,
    label: request.label,
    fingerprint,
    providerId: request.providerId,
    model: config.modelPath ?? '',
    resultBaseName: resultBaseName('phien-am', fingerprint),
    handler: async ({ signal, reportProgress }) => {
      // File WAV trung gian nằm trong cache của project, xoá được bất cứ lúc nào.
      const audioPath = join(
        projectPaths(request.projectId).cacheDir,
        `phien-am-${Date.now().toString(36)}.wav`
      )

      try {
        reportProgress({ indeterminate: true, stage: 'Đang trích âm thanh' })
        await extractAudioForTranscription({
          sourcePath: request.sourcePath,
          sourceInUs: request.sourceInUs,
          durationUs: request.durationUs,
          outputPath: audioPath
        })

        reportProgress({ indeterminate: true, stage: 'Đang nhận dạng' })
        const result = await adapter.transcribe(
          {
            apiKey: apiKey ?? '',
            config,
            signal,
            // whisper.cpp báo tiến trình thật; chuyển thẳng lên job.
            onProgress: (ratio) =>
              reportProgress({ value: ratio, indeterminate: false, stage: 'Đang nhận dạng' })
          },
          {
            model: config.modelPath ?? '',
            audioPath,
            language: request.language,
            wantWordTimestamps: true,
            wantSpeakerLabels: false,
            segmentation: request.segmentation
          }
        )

        const payload: TranscriptionJobResult = {
          language: result.language,
          languageAutoDetected: result.languageAutoDetected,
          segments: result.segments
        }
        return {
          bytes: new TextEncoder().encode(JSON.stringify(payload)),
          fileExtension: 'json'
        }
      } finally {
        // Audio trích ra chỉ để đưa cho engine; giữ lại chỉ tốn đĩa.
        await rm(audioPath, { force: true })
      }
    }
  })
}

/** Đọc kết quả phiên âm mà job đã ghi ra đĩa. */
export async function readTranscriptionResult(jobId: string): Promise<TranscriptionJobResult> {
  const job = jobQueue.get(jobId)
  if (!job) throw new Error(`Không tìm thấy tác vụ ${jobId}`)
  if (job.status !== 'succeeded' || !job.resultPath) {
    throw new Error(`Tác vụ ${jobId} chưa có kết quả phiên âm`)
  }

  const { readFile } = await import('node:fs/promises')
  const raw = await readFile(job.resultPath, 'utf8')
  return JSON.parse(raw) as TranscriptionJobResult
}
