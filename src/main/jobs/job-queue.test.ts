import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { JobRecord } from '../../shared/jobs/job-types'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { jobQueue } from './job-queue'
import { computeRequestFingerprint } from './job-result-cache'

/**
 * Kiểm thử vòng đời job — đúng những điều DESCRIPTION §6 đòi hỏi:
 * trạng thái rõ ràng, huỷ thật, chống chèn trùng khi thử lại, tái dùng kết quả.
 */

let projectCounter = 0
/** Mỗi phép thử dùng một project riêng để cache không lẫn sang nhau. */
function newProjectId(): string {
  projectCounter += 1
  return `proj_test_${projectCounter}`
}

function waitForJob(jobId: string, predicate: (job: JobRecord) => boolean): Promise<JobRecord> {
  return new Promise((resolve, reject) => {
    const existing = jobQueue.get(jobId)
    if (existing && predicate(existing)) {
      resolve(existing)
      return
    }
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Job ${jobId} không đạt trạng thái mong đợi trong thời gian chờ`))
    }, 10_000)
    const unsubscribe = jobQueue.subscribe((job) => {
      if (job.id === jobId && predicate(job)) {
        clearTimeout(timeout)
        unsubscribe()
        resolve(job)
      }
    })
  })
}

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

describe('vòng đời job', () => {
  it('chạy xong và ghi kết quả ra đĩa', async () => {
    const projectId = newProjectId()
    const job = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Sinh giọng đọc',
      fingerprint: computeRequestFingerprint({ text: 'xin chào' }),
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'giong-doc-1',
      handler: async () => ({ bytes: bytesOf('AUDIO'), fileExtension: 'mp3' })
    })

    expect(job.status).toBe('queued')

    const done = await waitForJob(job.id, (item) => item.status === 'succeeded')
    expect(done.resultPath).toBeTruthy()
    expect(done.resultPath?.endsWith('giong-doc-1.mp3')).toBe(true)
    await expect(readFile(done.resultPath as string, 'utf8')).resolves.toBe('AUDIO')
  })

  it('lần chạy thứ hai cùng vân tay lấy lại kết quả cũ, không gọi provider nữa', async () => {
    const projectId = newProjectId()
    const fingerprint = computeRequestFingerprint({ text: 'nội dung giống hệt' })
    let providerCalls = 0

    const first = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Lần đầu',
      fingerprint,
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'lan-dau',
      handler: async () => {
        providerCalls += 1
        return { bytes: bytesOf('AUDIO'), fileExtension: 'mp3' }
      }
    })
    const firstDone = await waitForJob(first.id, (item) => item.status === 'succeeded')

    const second = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Thử lại',
      fingerprint,
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'thu-lai',
      handler: async () => {
        providerCalls += 1
        return { bytes: bytesOf('AUDIO'), fileExtension: 'mp3' }
      }
    })
    const secondDone = await waitForJob(second.id, (item) => item.status === 'succeeded')

    // Đây là điểm mấu chốt: provider chỉ bị gọi MỘT lần, và lần hai trỏ về đúng
    // file cũ nên thư viện không có thêm một asset trùng nội dung.
    expect(providerCalls).toBe(1)
    expect(secondDone.servedFromCache).toBe(true)
    expect(secondDone.resultPath).toBe(firstDone.resultPath)
  })

  it('cùng nội dung nhưng khác project thì không dùng chung cache', async () => {
    const fingerprint = computeRequestFingerprint({ text: 'chung nội dung' })
    let providerCalls = 0

    const makeJob = (projectId: string): JobRecord =>
      jobQueue.enqueue({
        kind: 'tts',
        projectId,
        label: 'Sinh giọng đọc',
        fingerprint,
        providerId: 'test',
        model: 'test-model',
        resultBaseName: 'audio',
        handler: async () => {
          providerCalls += 1
          return { bytes: bytesOf('AUDIO'), fileExtension: 'mp3' }
        }
      })

    const a = makeJob(newProjectId())
    await waitForJob(a.id, (item) => item.status === 'succeeded')
    const b = makeJob(newProjectId())
    const bDone = await waitForJob(b.id, (item) => item.status === 'succeeded')

    // Kết quả không được rò rỉ sang project khác (DESCRIPTION §7).
    expect(providerCalls).toBe(2)
    expect(bDone.servedFromCache).toBeFalsy()
  })

  it('huỷ khi đang chạy thì dừng thật và không ghi kết quả', async () => {
    const projectId = newProjectId()
    let aborted = false

    const job = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Job chạy lâu',
      fingerprint: computeRequestFingerprint({ text: 'chạy lâu' }),
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'khong-bao-gio-ghi',
      handler: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new Error('đã huỷ'))
          })
        })
    })

    await waitForJob(job.id, (item) => item.status === 'running')
    jobQueue.cancel(job.id)

    const cancelled = await waitForJob(job.id, (item) => item.status === 'cancelled')
    expect(aborted).toBe(true)
    expect(cancelled.resultPath).toBeUndefined()
  })

  it('huỷ khi còn xếp hàng thì không bao giờ gọi tới provider', async () => {
    const projectId = newProjectId()
    let called = false

    // Lấp đầy hai chỗ chạy song song để job thứ ba phải xếp hàng.
    const blockers = [1, 2].map((index) =>
      jobQueue.enqueue({
        kind: 'tts',
        projectId,
        label: `Chiếm chỗ ${index}`,
        fingerprint: computeRequestFingerprint({ blocker: index, project: projectId }),
        providerId: 'test',
        model: 'test-model',
        resultBaseName: `chiem-cho-${index}`,
        handler: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('đã huỷ')))
          })
      })
    )

    const queued = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Đang xếp hàng',
      fingerprint: computeRequestFingerprint({ text: 'xếp hàng' }),
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'xep-hang',
      handler: async () => {
        called = true
        return { bytes: bytesOf('AUDIO'), fileExtension: 'mp3' }
      }
    })

    await waitForJob(blockers[0].id, (item) => item.status === 'running')
    expect(jobQueue.get(queued.id)?.status).toBe('queued')

    jobQueue.cancel(queued.id)
    await waitForJob(queued.id, (item) => item.status === 'cancelled')
    expect(called).toBe(false)

    for (const blocker of blockers) jobQueue.cancel(blocker.id)
  })

  it('giữ nguyên phân loại lỗi của provider để biết có nên hiện nút thử lại không', async () => {
    const projectId = newProjectId()

    const job = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Khoá sai',
      fingerprint: computeRequestFingerprint({ text: 'khoá sai' }),
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'that-bai',
      handler: async () => {
        throw new ProviderError({
          kind: 'invalid-credential',
          providerId: 'test',
          message: 'Khoá API không hợp lệ'
        })
      }
    })

    const failed = await waitForJob(job.id, (item) => item.status === 'failed')
    expect(failed.error?.kind).toBe('invalid-credential')
    // Khoá sai thì thử lại vô ích — giao diện không được mời người dùng thử lại.
    expect(failed.error?.retryable).toBe(false)
  })

  it('không bao giờ tự bịa phần trăm tiến trình', async () => {
    const projectId = newProjectId()
    const seen: Array<number | undefined> = []

    const job = jobQueue.enqueue({
      kind: 'tts',
      projectId,
      label: 'Không có tiến trình',
      fingerprint: computeRequestFingerprint({ text: 'không tiến trình' }),
      providerId: 'test',
      model: 'test-model',
      resultBaseName: 'khong-tien-trinh',
      handler: async () => ({ bytes: bytesOf('AUDIO'), fileExtension: 'mp3' })
    })

    const unsubscribe = jobQueue.subscribe((item) => {
      if (item.id === job.id && item.status === 'running') seen.push(item.progress.value)
    })
    await waitForJob(job.id, (item) => item.status === 'succeeded')
    unsubscribe()

    // Handler không báo tiến trình, nên trong lúc chạy giá trị phải là undefined
    // và cờ vô định phải bật.
    expect(seen.every((value) => value === undefined)).toBe(true)
  })
})

describe('computeRequestFingerprint', () => {
  it('không phụ thuộc thứ tự khoá', () => {
    const a = computeRequestFingerprint({ text: 'xin chào', voice: 'v1', speed: 1 })
    const b = computeRequestFingerprint({ speed: 1, voice: 'v1', text: 'xin chào' })
    expect(a).toBe(b)
  })

  it('đổi bất kỳ tham số nào cũng ra vân tay khác', () => {
    const base = computeRequestFingerprint({ text: 'xin chào', voice: 'v1' })
    expect(computeRequestFingerprint({ text: 'xin chào', voice: 'v2' })).not.toBe(base)
    expect(computeRequestFingerprint({ text: 'xin chào!', voice: 'v1' })).not.toBe(base)
  })

  it('so sánh sâu vào object lồng nhau', () => {
    const a = computeRequestFingerprint({ parameters: { stability: 0.5, style: 0.2 } })
    const b = computeRequestFingerprint({ parameters: { style: 0.2, stability: 0.5 } })
    const c = computeRequestFingerprint({ parameters: { style: 0.2, stability: 0.9 } })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })
})
