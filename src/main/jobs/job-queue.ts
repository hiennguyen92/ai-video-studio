import type { WebContents } from 'electron'
import type { JobKind, JobProgress, JobRecord } from '../../shared/jobs/job-types'
import { createId } from '../../shared/domain/project-document-factory'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { lookupCachedResult, rememberResult, storeResultFile } from './job-result-cache'

/**
 * Hàng đợi job nền.
 *
 * Giới hạn số job chạy song song: gọi provider ồ ạt sẽ dính rate limit, mà lỗi
 * rate limit thì khó hiểu hơn nhiều so với việc chờ thêm vài giây.
 *
 * Mỗi job giữ một `AbortController` riêng, nên huỷ là huỷ thật — request HTTP
 * đang bay bị cắt chứ không phải chỉ đánh dấu trạng thái rồi kệ nó chạy tiếp.
 */

const MAX_CONCURRENT_JOBS = 2

export interface JobHandlerContext {
  signal: AbortSignal
  reportProgress(progress: JobProgress): void
}

export interface JobHandlerResult {
  /** Nội dung kết quả để ghi ra đĩa. */
  bytes: Uint8Array
  fileExtension: string
}

export type JobHandler = (context: JobHandlerContext) => Promise<JobHandlerResult>

export interface EnqueueOptions {
  kind: JobKind
  projectId: string
  label: string
  fingerprint: string
  providerId: string
  model: string
  /** Tên file kết quả, chưa gồm đuôi. */
  resultBaseName: string
  handler: JobHandler
}

interface ActiveJob {
  record: JobRecord
  controller: AbortController
}

type JobListener = (job: JobRecord) => void

class JobQueue {
  private jobs = new Map<string, ActiveJob>()
  private waiting: string[] = []
  private running = new Set<string>()
  private listeners = new Set<JobListener>()
  private handlers = new Map<string, JobHandler>()
  private resultNames = new Map<string, string>()

  subscribe(listener: JobListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(record: JobRecord): void {
    for (const listener of this.listeners) listener({ ...record })
  }

  list(projectId?: string): JobRecord[] {
    const all = [...this.jobs.values()].map((entry) => entry.record)
    return projectId ? all.filter((job) => job.projectId === projectId) : all
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)?.record
  }

  enqueue(options: EnqueueOptions): JobRecord {
    const record: JobRecord = {
      id: createId('job'),
      kind: options.kind,
      projectId: options.projectId,
      status: 'queued',
      progress: { indeterminate: true },
      label: options.label,
      fingerprint: options.fingerprint,
      providerId: options.providerId,
      model: options.model,
      createdAt: new Date().toISOString()
    }

    this.jobs.set(record.id, { record, controller: new AbortController() })
    this.handlers.set(record.id, options.handler)
    this.resultNames.set(record.id, options.resultBaseName)
    this.waiting.push(record.id)

    this.emit(record)
    void this.pump()
    return { ...record }
  }

  cancel(jobId: string): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return

    if (entry.record.status === 'queued') {
      // Chưa chạy thì chỉ cần nhấc khỏi hàng đợi.
      this.waiting = this.waiting.filter((id) => id !== jobId)
      this.finish(jobId, { status: 'cancelled' })
      return
    }

    if (entry.record.status === 'running') {
      entry.controller.abort()
    }
  }

  cancelAllForProject(projectId: string): void {
    for (const entry of this.jobs.values()) {
      if (entry.record.projectId === projectId) this.cancel(entry.record.id)
    }
  }

  cancelAll(): void {
    for (const entry of this.jobs.values()) this.cancel(entry.record.id)
  }

  /** Xoá các job đã kết thúc khỏi danh sách hiển thị. */
  clearFinished(projectId: string): void {
    for (const [id, entry] of this.jobs) {
      const finished = ['succeeded', 'failed', 'cancelled'].includes(entry.record.status)
      if (finished && entry.record.projectId === projectId) {
        this.jobs.delete(id)
        this.handlers.delete(id)
        this.resultNames.delete(id)
      }
    }
  }

  private update(jobId: string, patch: Partial<JobRecord>): void {
    const entry = this.jobs.get(jobId)
    if (!entry) return
    entry.record = { ...entry.record, ...patch }
    this.emit(entry.record)
  }

  private finish(jobId: string, patch: Partial<JobRecord>): void {
    this.running.delete(jobId)
    this.update(jobId, { ...patch, finishedAt: new Date().toISOString() })
    void this.pump()
  }

  private async pump(): Promise<void> {
    while (this.running.size < MAX_CONCURRENT_JOBS && this.waiting.length > 0) {
      const jobId = this.waiting.shift()
      if (!jobId) return
      const entry = this.jobs.get(jobId)
      if (!entry || entry.record.status !== 'queued') continue

      this.running.add(jobId)
      void this.execute(jobId)
    }
  }

  private async execute(jobId: string): Promise<void> {
    const entry = this.jobs.get(jobId)
    const handler = this.handlers.get(jobId)
    const baseName = this.resultNames.get(jobId)
    if (!entry || !handler || !baseName) return

    const { record, controller } = entry

    // Trúng cache thì không gọi provider: vừa đỡ tốn tiền, vừa tránh sinh ra một
    // asset thứ hai trùng nội dung khi người dùng bấm Thử lại.
    const cached = await lookupCachedResult(record.projectId, record.fingerprint)
    if (cached) {
      this.finish(jobId, {
        status: 'succeeded',
        resultPath: cached.path,
        servedFromCache: true,
        progress: { indeterminate: false, value: 1 }
      })
      return
    }

    this.update(jobId, {
      status: 'running',
      startedAt: new Date().toISOString(),
      progress: { indeterminate: true }
    })

    try {
      const result = await handler({
        signal: controller.signal,
        reportProgress: (progress) => this.update(jobId, { progress })
      })

      if (controller.signal.aborted) {
        this.finish(jobId, { status: 'cancelled' })
        return
      }

      const path = await storeResultFile(
        record.projectId,
        `${baseName}.${result.fileExtension}`,
        result.bytes
      )
      await rememberResult(record.projectId, {
        fingerprint: record.fingerprint,
        path,
        providerId: record.providerId,
        model: record.model
      })

      this.finish(jobId, {
        status: 'succeeded',
        resultPath: path,
        progress: { indeterminate: false, value: 1 }
      })
    } catch (error) {
      if (controller.signal.aborted) {
        this.finish(jobId, { status: 'cancelled' })
        return
      }

      const providerError = error instanceof ProviderError ? error : null
      this.finish(jobId, {
        status: 'failed',
        error: {
          kind: providerError?.kind ?? 'unknown',
          message: error instanceof Error ? error.message : String(error),
          retryable: providerError?.retryable ?? true
        }
      })
    }
  }
}

export const jobQueue = new JobQueue()

/** Chuyển tiếp mọi thay đổi job về renderer. */
export function bridgeJobEvents(sender: WebContents, channel: string): () => void {
  return jobQueue.subscribe((job) => {
    if (!sender.isDestroyed()) sender.send(channel, { job })
  })
}
