import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { classifyHttpStatus, extractErrorMessage } from './provider-http-client'
import { elevenLabsTtsAdapter } from './elevenlabs-tts-adapter'
import { openAiTtsAdapter } from './openai-tts-adapter'

/**
 * ⚠️ KIỂM THỬ BẰNG FIXTURE — CHƯA GỌI PROVIDER THẬT.
 *
 * Ở thời điểm viết, dự án chưa có khoá API của ElevenLabs hay OpenAI, nên các
 * phép thử này chạy với một máy chủ HTTP cục bộ trả về phản hồi có HÌNH DẠNG
 * đúng theo tài liệu chính thức (xem researcher-04-tts-provider-api-verification.md).
 *
 * Chúng kiểm chứng được:
 *   - adapter dựng đúng đường dẫn, phương thức, tên header xác thực, tên trường body
 *   - adapter đọc đúng hình dạng phản hồi, kể cả phân trang
 *   - adapter phân loại đúng lỗi HTTP
 *   - adapter chặn trước những yêu cầu chắc chắn sai
 *
 * Chúng KHÔNG kiểm chứng được:
 *   - phản hồi thật của provider có đúng như tài liệu mô tả không
 *   - chất lượng giọng đọc tiếng Việt
 *   - hành vi thật khi bị giới hạn tần suất hoặc hết hạn mức
 *
 * DESCRIPTION §10 yêu cầu nói rõ điều này thay vì coi fixture là đã tích hợp xong.
 */

interface CapturedRequest {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

let server: Server
let baseUrl: string
let captured: CapturedRequest[] = []
/** Điều khiển phản hồi của máy chủ giả cho từng phép thử. */
let respond: (request: CapturedRequest, response: ServerResponse) => void

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    request.on('data', (chunk) => {
      data += chunk
    })
    request.on('end', () => resolve(data))
  })
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    const entry: CapturedRequest = {
      method: request.method ?? '',
      path: request.url ?? '',
      headers: request.headers,
      body: await readBody(request)
    }
    captured.push(entry)
    respond(entry, response)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Không lấy được cổng máy chủ giả')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function context(): AdapterContext {
  return { apiKey: 'khoa-gia-dung-cho-kiem-thu', signal: new AbortController().signal }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

/**
 * Adapter trỏ vào máy chủ thật của provider, nên phép thử phải chuyển hướng
 * `fetch` sang máy chủ giả. Chỉ đổi phần gốc URL, giữ nguyên đường dẫn và query
 * để vẫn kiểm chứng được adapter dựng đường dẫn đúng hay không.
 */
function redirectFetchToStub(realOrigins: string[]): () => void {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input.toString())
    if (realOrigins.includes(url.origin)) {
      return originalFetch(`${baseUrl}${url.pathname}${url.search}`, init)
    }
    return originalFetch(input as string, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = originalFetch
  }
}

const ELEVENLABS_ORIGIN = 'https://api.elevenlabs.io'
const OPENAI_ORIGIN = 'https://api.openai.com'

describe('ElevenLabs adapter (fixture)', () => {
  it('gọi đúng endpoint liệt kê giọng với header xác thực đúng tên', async () => {
    captured = []
    respond = (_request, response) =>
      sendJson(response, 200, {
        voices: [
          {
            voice_id: 'v-001',
            name: 'Giọng thử',
            preview_url: 'https://example.invalid/preview.mp3',
            verified_languages: [{ language: 'vi' }, { language: 'en' }]
          }
        ],
        has_more: false,
        total_count: 1
      })

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const voices = await elevenLabsTtsAdapter.listVoices(context())
    restore()

    expect(captured[0].method).toBe('GET')
    expect(captured[0].path.startsWith('/v2/voices')).toBe(true)
    // Tên header phải đúng chính xác; sai tên là 401 mà không rõ vì sao.
    expect(captured[0].headers['xi-api-key']).toBe('khoa-gia-dung-cho-kiem-thu')
    expect(captured[0].headers.authorization).toBeUndefined()

    expect(voices).toHaveLength(1)
    expect(voices[0]).toMatchObject({
      id: 'v-001',
      name: 'Giọng thử',
      previewUrl: 'https://example.invalid/preview.mp3'
    })
    expect(voices[0].languages).toEqual(['vi', 'en'])
  })

  it('đi hết các trang khi tài khoản có nhiều giọng', async () => {
    captured = []
    respond = (request, response) => {
      const isSecondPage = request.path.includes('next_page_token=trang-2')
      sendJson(response, 200, {
        voices: [{ voice_id: isSecondPage ? 'v-2' : 'v-1', name: isSecondPage ? 'Hai' : 'Một' }],
        has_more: !isSecondPage,
        next_page_token: isSecondPage ? undefined : 'trang-2'
      })
    }

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const voices = await elevenLabsTtsAdapter.listVoices(context())
    restore()

    expect(captured).toHaveLength(2)
    expect(voices.map((voice) => voice.id)).toEqual(['v-1', 'v-2'])
  })

  it('giữ lại giọng không công bố ngôn ngữ khi lọc theo tiếng Việt', async () => {
    captured = []
    respond = (_request, response) =>
      sendJson(response, 200, {
        voices: [
          { voice_id: 'co-vi', name: 'Có VI', verified_languages: [{ language: 'vi' }] },
          { voice_id: 'chi-en', name: 'Chỉ EN', verified_languages: [{ language: 'en' }] },
          { voice_id: 'khong-ro', name: 'Không rõ' }
        ],
        has_more: false
      })

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const voices = await elevenLabsTtsAdapter.listVoices(context(), { language: 'vi' })
    restore()

    // Giọng khai báo tiếng Anh bị loại; giọng không khai báo gì thì giữ lại vì
    // loại bỏ chúng sẽ giấu mất những giọng vẫn dùng được.
    expect(voices.map((voice) => voice.id)).toEqual(['co-vi', 'khong-ro'])
  })

  it('dựng đúng thân yêu cầu sinh giọng đọc', async () => {
    captured = []
    respond = (_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.end(Buffer.from('DU-LIEU-AUDIO-GIA'))
    }

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const result = await elevenLabsTtsAdapter.synthesize(context(), {
      model: 'eleven_multilingual_v2',
      voiceId: 'v-001',
      text: 'Xin chào Việt Nam',
      language: 'vi',
      parameters: { stability: 0.4, similarity_boost: 0.8, use_speaker_boost: true },
      outputFormat: 'mp3_44100_128'
    })
    restore()

    const request = captured[0]
    expect(request.method).toBe('POST')
    expect(request.path).toContain('/v1/text-to-speech/v-001')
    expect(request.path).toContain('output_format=mp3_44100_128')

    const body = JSON.parse(request.body) as Record<string, unknown>
    // Tên trường phải khớp tài liệu: model_id chứ không phải model, language_code
    // chứ không phải language.
    expect(body.text).toBe('Xin chào Việt Nam')
    expect(body.model_id).toBe('eleven_multilingual_v2')
    expect(body.language_code).toBe('vi')
    expect(body.voice_settings).toEqual({
      stability: 0.4,
      similarity_boost: 0.8,
      use_speaker_boost: true
    })

    expect(result.fileExtension).toBe('mp3')
    expect(Buffer.from(result.audio).toString()).toBe('DU-LIEU-AUDIO-GIA')
  })

  it('chặn văn bản vượt giới hạn ký tự TRƯỚC khi gọi mạng', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 200, {})

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const attempt = elevenLabsTtsAdapter.synthesize(context(), {
      model: 'eleven_v3',
      voiceId: 'v-001',
      // Model v3 giới hạn 3.000 ký tự.
      text: 'a'.repeat(3_500),
      parameters: {},
      outputFormat: 'mp3_44100_128'
    })

    await expect(attempt).rejects.toThrow(ProviderError)
    await expect(attempt).rejects.toThrow(/vượt giới hạn 3000/)
    restore()

    // Không được tốn một lần gọi mạng cho yêu cầu chắc chắn bị từ chối.
    expect(captured).toHaveLength(0)
  })

  it('phân loại khoá sai thành lỗi không đáng thử lại', async () => {
    captured = []
    respond = (_request, response) =>
      sendJson(response, 401, {
        detail: { status: 'invalid_api_key', message: 'Khoá không hợp lệ' }
      })

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const result = await elevenLabsTtsAdapter.testConnection(context())
    restore()

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Khoá API bị từ chối')
  })

  it('báo kết nối thành công kèm số giọng khả dụng', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 200, { voices: [], total_count: 42 })

    const restore = redirectFetchToStub([ELEVENLABS_ORIGIN])
    const result = await elevenLabsTtsAdapter.testConnection(context())
    restore()

    expect(result.ok).toBe(true)
    expect(result.details).toContain('42')
  })
})

describe('OpenAI adapter (fixture)', () => {
  it('dựng đúng thân yêu cầu và dùng header Bearer', async () => {
    captured = []
    respond = (_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.end(Buffer.from('AUDIO'))
    }

    const restore = redirectFetchToStub([OPENAI_ORIGIN])
    await openAiTtsAdapter.synthesize(context(), {
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova',
      text: 'Xin chào',
      parameters: { speed: 1.25, instructions: 'Đọc chậm rãi, nhẹ nhàng.' },
      outputFormat: 'mp3'
    })
    restore()

    const request = captured[0]
    expect(request.path).toBe('/v1/audio/speech')
    expect(request.headers.authorization).toBe('Bearer khoa-gia-dung-cho-kiem-thu')

    const body = JSON.parse(request.body) as Record<string, unknown>
    // Endpoint dùng `input` chứ không phải `text`, và `voice` chứ không phải voice_id.
    expect(body.input).toBe('Xin chào')
    expect(body.voice).toBe('nova')
    expect(body.model).toBe('gpt-4o-mini-tts')
    expect(body.speed).toBe(1.25)
    expect(body.instructions).toBe('Đọc chậm rãi, nhẹ nhàng.')
    expect(body.response_format).toBe('mp3')
  })

  it('không gửi tốc độ mặc định và không gửi phong cách rỗng', async () => {
    captured = []
    respond = (_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/mpeg' })
      response.end(Buffer.from('AUDIO'))
    }

    const restore = redirectFetchToStub([OPENAI_ORIGIN])
    await openAiTtsAdapter.synthesize(context(), {
      model: 'gpt-4o-mini-tts',
      voiceId: 'nova',
      text: 'Xin chào',
      parameters: { speed: 1, instructions: '' },
      outputFormat: 'mp3'
    })
    restore()

    const body = JSON.parse(captured[0].body) as Record<string, unknown>
    expect(body).not.toHaveProperty('speed')
    expect(body).not.toHaveProperty('instructions')
  })

  it('từ chối giọng không dùng được với model cũ, trước khi gọi mạng', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 200, {})

    const restore = redirectFetchToStub([OPENAI_ORIGIN])
    const attempt = openAiTtsAdapter.synthesize(context(), {
      model: 'tts-1',
      // "cedar" chỉ dùng được với model thế hệ mới.
      voiceId: 'cedar',
      text: 'Xin chào',
      parameters: {},
      outputFormat: 'mp3'
    })

    await expect(attempt).rejects.toThrow(/không dùng được với model tts-1/)
    restore()
    expect(captured).toHaveLength(0)
  })

  it('chỉ khai báo tham số phong cách cho model thật sự hỗ trợ', () => {
    const modern = openAiTtsAdapter.capabilities('gpt-4o-mini-tts')
    const legacy = openAiTtsAdapter.capabilities('tts-1')

    expect(modern.parameters.map((parameter) => parameter.key)).toContain('instructions')
    // Đây chính là yêu cầu của DESCRIPTION §3.B: không bày ra tham số mà provider
    // không nhận. Với tts-1 thì ô phong cách đọc phải KHÔNG tồn tại.
    expect(legacy.parameters.map((parameter) => parameter.key)).not.toContain('instructions')
    expect(legacy.parameters.map((parameter) => parameter.key)).toContain('speed')
  })

  it('khai báo danh mục giọng là cố định, không phải lấy từ tài khoản', async () => {
    expect(openAiTtsAdapter.capabilities('gpt-4o-mini-tts').voiceCatalog).toBe('static')
    expect(elevenLabsTtsAdapter.capabilities('eleven_multilingual_v2').voiceCatalog).toBe('remote')

    // Danh mục cố định thì liệt kê giọng không được gọi mạng.
    captured = []
    const restore = redirectFetchToStub([OPENAI_ORIGIN])
    const voices = await openAiTtsAdapter.listVoices(context())
    restore()

    expect(captured).toHaveLength(0)
    expect(voices.length).toBeGreaterThan(0)
    // Tài liệu không gắn ngôn ngữ cho từng giọng nên không được bịa ra.
    expect(voices.every((voice) => voice.languages.length === 0)).toBe(true)
  })
})

describe('phân loại lỗi HTTP', () => {
  it('ánh xạ mã trạng thái sang phân loại dùng được', () => {
    expect(classifyHttpStatus(401)).toBe('invalid-credential')
    expect(classifyHttpStatus(403)).toBe('invalid-credential')
    expect(classifyHttpStatus(429)).toBe('rate-limited')
    expect(classifyHttpStatus(402)).toBe('quota-exceeded')
    expect(classifyHttpStatus(500)).toBe('server-error')
    expect(classifyHttpStatus(400)).toBe('bad-request')
  })

  it('rút được thông báo từ các hình dạng lỗi khác nhau', () => {
    expect(extractErrorMessage('{"error":{"message":"hết hạn mức"}}')).toBe('hết hạn mức')
    expect(extractErrorMessage('{"detail":"khoá sai"}')).toBe('khoá sai')
    expect(extractErrorMessage('{"detail":{"message":"quá tải"}}')).toBe('quá tải')
    expect(extractErrorMessage('không phải json')).toBe('không phải json')
  })

  it('lỗi tạm thời thì đáng thử lại, lỗi khoá sai thì không', () => {
    const rateLimited = new ProviderError({ kind: 'rate-limited', providerId: 'x', message: '' })
    const badKey = new ProviderError({ kind: 'invalid-credential', providerId: 'x', message: '' })
    expect(rateLimited.retryable).toBe(true)
    expect(badKey.retryable).toBe(false)
  })
})
