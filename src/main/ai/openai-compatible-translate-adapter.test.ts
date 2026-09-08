import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { openAiCompatibleTranslateAdapter } from './openai-compatible-translate-adapter'

/**
 * Adapter dịch được kiểm bằng MÁY CHỦ HTTP THẬT chạy tại chỗ, không phải bằng
 * hàm giả lập fetch.
 *
 * Lý do: phần dễ sai nhất nằm ở ranh giới mạng — hình dạng body gửi đi, header,
 * cách xử lý mã lỗi. Giả lập fetch sẽ kiểm chính giả định của mình chứ không
 * kiểm được giao thức.
 *
 * GIỚI HẠN CẦN NÓI RÕ (DESCRIPTION §10): máy chủ ở đây trả lời theo kịch bản
 * dựng sẵn để tái hiện đúng những kiểu trả lời sai của mô hình ngôn ngữ. Nó
 * chứng minh adapter xử lý đúng giao thức và đúng các ca hỏng, KHÔNG chứng minh
 * chất lượng bản dịch của một mô hình thật. Muốn kiểm mô hình thật, chạy nhóm
 * test trong `openai-compatible-translate-live.integration.test.ts`.
 */

interface CapturedRequest {
  path: string
  authorization?: string
  body: Record<string, unknown>
}

let server: Server
let baseUrl: string
let captured: CapturedRequest[] = []
/** Hàng đợi trả lời; mỗi lượt gọi lấy một phần tử. Hết thì dùng phần tử cuối. */
let scriptedReplies: string[] = []
let modelIds = ['qwen2.5:7b', 'llama3.2:3b']

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8')

      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: modelIds.map((id) => ({ id })) }))
        return
      }

      captured.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body: rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {}
      })

      const reply = scriptedReplies.shift() ?? scriptedReplies.at(-1) ?? '{"segments":[]}'
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Không mở được máy chủ thử')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function context(config: Record<string, string> = {}, apiKey = ''): AdapterContext {
  captured = []
  return {
    apiKey,
    config: { baseUrl, model: 'qwen2.5:7b', ...config },
    signal: new AbortController().signal
  }
}

const THREE = [
  { id: 's1', text: 'Hello' },
  { id: 's2', text: 'World' },
  { id: 's3', text: 'Goodbye' }
]

describe('openAiCompatibleTranslateAdapter', () => {
  it('gửi đúng đường dẫn và body kiểu OpenAI', async () => {
    scriptedReplies = ['{"segments":[{"id":"s1","text":"Xin chào"}]}']
    const ctx = context()

    await openAiCompatibleTranslateAdapter.translate(ctx, {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: [{ id: 's1', text: 'Hello' }]
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].path).toBe('/v1/chat/completions')
    expect(captured[0].body.model).toBe('qwen2.5:7b')
    // Dịch phụ đề cần bám sát bản gốc.
    expect(captured[0].body.temperature).toBe(0.2)
    expect(Array.isArray(captured[0].body.messages)).toBe(true)
  })

  it('không gửi header Authorization khi máy chủ local không cần khoá', async () => {
    scriptedReplies = ['{"segments":[{"id":"s1","text":"Xin chào"}]}']
    await openAiCompatibleTranslateAdapter.translate(context(), {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: [{ id: 's1', text: 'Hello' }]
    })
    expect(captured[0].authorization).toBeUndefined()
  })

  it('gửi Authorization khi có khoá, để dùng được với OpenAI', async () => {
    scriptedReplies = ['{"segments":[{"id":"s1","text":"Xin chào"}]}']
    await openAiCompatibleTranslateAdapter.translate(context({}, 'sk-thu-nghiem'), {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: [{ id: 's1', text: 'Hello' }]
    })
    expect(captured[0].authorization).toBe('Bearer sk-thu-nghiem')
  })

  it('hỏi lại đúng đoạn bị bỏ sót, không đoán theo thứ tự', async () => {
    // Lượt đầu thiếu s3 — đúng kiểu sai mà mô hình hay mắc với danh sách dài.
    scriptedReplies = [
      '{"segments":[{"id":"s1","text":"Xin chào"},{"id":"s2","text":"Thế giới"}]}',
      '{"segments":[{"id":"s3","text":"Tạm biệt"}]}'
    ]

    const result = await openAiCompatibleTranslateAdapter.translate(context(), {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: THREE
    })

    expect(captured).toHaveLength(2)
    // Lượt hỏi lại chỉ chứa đoạn còn thiếu.
    const repairPrompt = JSON.stringify(captured[1].body.messages)
    expect(repairPrompt).toContain('s3')
    expect(repairPrompt).not.toContain('Hello')

    expect(result.segments).toEqual([
      { id: 's1', text: 'Xin chào' },
      { id: 's2', text: 'Thế giới' },
      { id: 's3', text: 'Tạm biệt' }
    ])
  })

  it('giữ nguyên bản gốc khi mô hình chịu thua, không trả về đoạn rỗng', async () => {
    // Luôn trả lời vô dụng: adapter phải dừng lại và giữ liên kết nguyên vẹn.
    scriptedReplies = ['Tôi không dịch được.']

    const result = await openAiCompatibleTranslateAdapter.translate(context(), {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: THREE
    })

    // Số đoạn ra phải bằng số đoạn vào — đây là bất biến quan trọng nhất.
    expect(result.segments).toHaveLength(3)
    expect(result.segments.map((segment) => segment.id)).toEqual(['s1', 's2', 's3'])
    expect(result.segments[2].text).toBe('Goodbye')
  })

  it('chia lô theo cấu hình và báo tiến trình thật', async () => {
    scriptedReplies = [
      '{"segments":[{"id":"s1","text":"A"},{"id":"s2","text":"B"}]}',
      '{"segments":[{"id":"s3","text":"C"}]}'
    ]
    const ratios: number[] = []

    const result = await openAiCompatibleTranslateAdapter.translate(
      { ...context({ batchSize: '2' }), onProgress: (ratio) => ratios.push(ratio) },
      { model: 'qwen2.5:7b', targetLanguage: 'vi', segments: THREE }
    )

    expect(captured).toHaveLength(2)
    expect(result.segments).toHaveLength(3)
    // Tiến trình đi từ nửa chừng tới hết, theo số lô thật chứ không phải số ước lượng.
    expect(ratios).toEqual([0.5, 1])
  })

  it('đưa glossary vào lượt gọi', async () => {
    scriptedReplies = ['{"segments":[{"id":"s1","text":"Kéo lên dòng thời gian"}]}']

    await openAiCompatibleTranslateAdapter.translate(context(), {
      model: 'qwen2.5:7b',
      targetLanguage: 'vi',
      segments: [{ id: 's1', text: 'Drag to the timeline' }],
      glossary: [{ from: 'timeline', to: 'dòng thời gian' }]
    })

    expect(JSON.stringify(captured[0].body.messages)).toContain('dòng thời gian')
  })

  it('báo lỗi rõ ràng khi chưa chọn model', async () => {
    await expect(
      openAiCompatibleTranslateAdapter.translate(context({ model: '' }), {
        model: '',
        targetLanguage: 'vi',
        segments: [{ id: 's1', text: 'Hello' }]
      })
    ).rejects.toThrow(/Chưa chọn model/)
  })

  describe('testConnection', () => {
    it('báo được khi máy chủ có model đã chọn', async () => {
      modelIds = ['qwen2.5:7b', 'llama3.2:3b']
      const result = await openAiCompatibleTranslateAdapter.testConnection(context())
      expect(result.ok).toBe(true)
      expect(result.details).toContain('qwen2.5:7b')
    })

    it('nói thẳng khi máy chủ không có model đã điền', async () => {
      modelIds = ['llama3.2:3b']
      const result = await openAiCompatibleTranslateAdapter.testConnection(context())
      expect(result.ok).toBe(false)
      expect(result.message).toContain('không có model "qwen2.5:7b"')
      // Phải liệt kê model đang có để người dùng sửa được ngay.
      expect(result.details).toContain('llama3.2:3b')
    })

    it('báo rõ khi máy chủ chạy nhưng chưa tải model nào', async () => {
      modelIds = []
      const result = await openAiCompatibleTranslateAdapter.testConnection(context())
      expect(result.ok).toBe(false)
      expect(result.message).toContain('chưa có model nào')
    })

    it('không treo khi máy chủ tắt hẳn', async () => {
      const result = await openAiCompatibleTranslateAdapter.testConnection({
        apiKey: '',
        // Cổng chắc chắn không có ai nghe.
        config: { baseUrl: 'http://127.0.0.1:1/v1', model: 'x' },
        signal: new AbortController().signal
      })
      expect(result.ok).toBe(false)
      expect(result.message.length).toBeGreaterThan(0)
    }, 30_000)
  })
})
