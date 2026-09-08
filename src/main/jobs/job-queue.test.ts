import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { JobRecord } from '../../shared/jobs/job-types'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { jobQueue } from './job-queue'
import { computeRequestFingerprint, resultBaseName } from './job-result-cache'

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

describe('tên file kết quả', () => {
  it('chín câu xếp hàng cùng lúc ra chín file KHÁC nhau', async () => {
    const projectId = newProjectId()
    const lines = [
      'Bé bằng bàn tay mà thổi bay cả tờ giấy.',
      'Gấp lại nhỏ như cây bút.',
      'Mở ra hai giây là thành quạt.',
      'Gió mạnh mà chạy rất êm.',
      'Đủ mát cho cả mặt và cổ.',
      'Gập chân đế xuống là để bàn.',
      'Kiêm luôn đèn ngủ ánh vàng dịu.',
      'Kiêm cả sạc dự phòng.',
      'Giỏ hàng màu cam ngay bên dưới nhé.'
    ]

    // Xếp hàng TẤT CẢ trong cùng một nhịp, đúng như nút "Tạo audio" làm. Đặt tên
    // theo Date.now() thì nhiều job rơi vào cùng một mili giây, trùng tên và ghi
    // đè lên nhau — quan sát thật: 9 câu chỉ còn 2 file, timeline đọc sai câu.
    const jobs = lines.map((text) => {
      const fingerprint = computeRequestFingerprint({ task: 'tts', text })
      return jobQueue.enqueue({
        kind: 'tts',
        projectId,
        label: text,
        fingerprint,
        providerId: 'test',
        model: 'test-model',
        resultBaseName: resultBaseName('giong-doc', fingerprint),
        handler: async () => ({ bytes: bytesOf(text), fileExtension: 'mp3' })
      })
    })

    const finished = await Promise.all(
      jobs.map((job) => waitForJob(job.id, (item) => item.status === 'succeeded'))
    )

    const paths = finished.map((job) => job.resultPath as string)
    expect(new Set(paths).size).toBe(lines.length)

    // Và nội dung thật trên đĩa phải khớp từng câu, không phải câu của job khác.
    for (const [index, path] of paths.entries()) {
      expect(await readFile(path, 'utf8')).toBe(lines[index])
    }
  }, 30_000)

  it('cùng một yêu cầu vẫn ra cùng tên file, để dùng lại kết quả cũ', () => {
    const fingerprint = computeRequestFingerprint({ task: 'tts', text: 'xin chào' })

    expect(resultBaseName('giong-doc', fingerprint)).toBe(resultBaseName('giong-doc', fingerprint))
    expect(resultBaseName('giong-doc', fingerprint)).not.toBe(
      resultBaseName('giong-doc', computeRequestFingerprint({ task: 'tts', text: 'tạm biệt' }))
    )
  })
})

describe('chỉ mục cache khi nhiều job xong cùng lúc', () => {
  it('không job nào ngã, và MỌI vân tay đều được nhớ lại', async () => {
    const projectId = newProjectId()
    const texts = Array.from({ length: 8 }, (_, index) => `câu số ${index}`)

    const jobs = texts.map((text) => {
      const fingerprint = computeRequestFingerprint({ task: 'tts', text })
      return jobQueue.enqueue({
        kind: 'tts',
        projectId,
        label: text,
        fingerprint,
        providerId: 'test',
        model: 'test-model',
        resultBaseName: resultBaseName('giong-doc', fingerprint),
        handler: async () => ({ bytes: bytesOf(text), fileExtension: 'mp3' })
      })
    })

    await Promise.all(jobs.map((job) => waitForJob(job.id, (item) => item.status === 'succeeded')))

    // Xếp hàng lại y hệt: mọi job phải TRÚNG cache. Trượt một mục nghĩa là hai
    // lượt ghi chỉ mục đã đè lên nhau và kết quả sẽ bị sinh lại — với provider
    // tính tiền thì đó là tiền mất thật.
    const again = texts.map((text) =>
      jobQueue.enqueue({
        kind: 'tts',
        projectId,
        label: text,
        fingerprint: computeRequestFingerprint({ task: 'tts', text }),
        providerId: 'test',
        model: 'test-model',
        resultBaseName: resultBaseName(
          'giong-doc',
          computeRequestFingerprint({ task: 'tts', text })
        ),
        handler: async () => {
          throw new Error('không được sinh lại: kết quả đã có trong cache')
        }
      })
    )

    const finished = await Promise.all(
      again.map((job) => waitForJob(job.id, (item) => item.status === 'succeeded'))
    )
    expect(finished.every((job) => Boolean(job.resultPath))).toBe(true)
  }, 30_000)
})
