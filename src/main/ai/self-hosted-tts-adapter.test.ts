import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { normaliseBaseUrl } from '../secrets/provider-config-store'
import { selfHostedOpenAiTtsAdapter } from './self-hosted-openai-tts-adapter'

/**
 * Kiểm thử adapter máy chủ tự host bằng một máy chủ HTTP THẬT chạy trong tiến
 * trình test, nói đúng giao thức `POST /v1/audio/speech` kiểu OpenAI.
 *
 * Đây không phải bản giả lập của adapter — adapter chạy thật, chỉ có phía bên kia
 * dây là máy chủ do test dựng. Nhờ vậy kiểm chứng được đúng thứ dễ sai nhất:
 * đường dẫn, tên trường, và cách xử lý khi máy chủ THIẾU endpoint phụ.
 *
 * ⚠️ CHƯA kiểm chứng với omnivoice-server thật: chạy nó cần PyTorch và tải model
 * hàng GB. Hợp đồng ở đây dựng theo tài liệu của dự án đó (xem
 * plans/research/researcher-05-omnivoice-selfhosted-tts.md).
 */

interface Captured {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

let server: Server
let baseUrl: string
let captured: Captured[] = []
let respond: (request: Captured, response: ServerResponse) => void

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
    const entry: Captured = {
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
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function context(config: Record<string, string> = {}, apiKey = ''): AdapterContext {
  return {
    apiKey,
    config: { baseUrl, ...config },
    signal: new AbortController().signal
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(payload))
}

function sendAudio(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'audio/wav' })
  response.end(Buffer.from('DU-LIEU-AUDIO-WAV-GIA'))
}

describe('adapter máy chủ tự host', () => {
  it('gửi đúng đường dẫn và tên trường của giao thức OpenAI', async () => {
    captured = []
    respond = (_request, response) => sendAudio(response)

    const result = await selfHostedOpenAiTtsAdapter.synthesize(context({ model: 'omnivoice' }), {
      model: 'omnivoice',
      voiceId: 'vi-female',
      text: 'Xin chào Việt Nam',
      parameters: { speed: 1.2 },
      outputFormat: 'wav'
    })

    const request = captured[0]
    expect(request.method).toBe('POST')
    expect(request.path).toBe('/v1/audio/speech')

    const body = JSON.parse(request.body) as Record<string, unknown>
    expect(body.model).toBe('omnivoice')
    expect(body.input).toBe('Xin chào Việt Nam')
    expect(body.voice).toBe('vi-female')
    expect(body.response_format).toBe('wav')
    expect(body.speed).toBe(1.2)

    expect(result.fileExtension).toBe('wav')
    expect(Buffer.from(result.audio).toString()).toContain('AUDIO')
  })

  it('không gửi header xác thực khi máy chủ không cần khoá', async () => {
    captured = []
    respond = (_request, response) => sendAudio(response)

    await selfHostedOpenAiTtsAdapter.synthesize(context(), {
      model: 'omnivoice',
      voiceId: '',
      text: 'thử',
      parameters: {},
      outputFormat: 'wav'
    })

    // Máy chủ chạy trong máy thường không có xác thực; gửi Bearer rỗng có thể
    // khiến một số máy chủ từ chối.
    expect(captured[0].headers.authorization).toBeUndefined()
    // Không chỉ định giọng thì không gửi trường `voice` để máy chủ dùng mặc định.
    expect(JSON.parse(captured[0].body)).not.toHaveProperty('voice')
  })

  it('gửi header xác thực khi người dùng có nhập khoá', async () => {
    captured = []
    respond = (_request, response) => sendAudio(response)

    await selfHostedOpenAiTtsAdapter.synthesize(context({}, 'khoa-noi-bo'), {
      model: 'omnivoice',
      voiceId: 'a',
      text: 'thử',
      parameters: {},
      outputFormat: 'wav'
    })

    expect(captured[0].headers.authorization).toBe('Bearer khoa-noi-bo')
  })

  it('dùng danh sách giọng người dùng khai báo, không gọi mạng', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 200, {})

    const voices = await selfHostedOpenAiTtsAdapter.listVoices(
      context({ voices: 'alloy, vi-female , nova' })
    )

    expect(voices.map((voice) => voice.id)).toEqual(['alloy', 'vi-female', 'nova'])
    expect(captured).toHaveLength(0)
  })

  it('dò được danh sách giọng khi máy chủ có endpoint đó', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 200, { voices: ['giong-1', 'giong-2'] })

    const voices = await selfHostedOpenAiTtsAdapter.listVoices(context())

    expect(captured[0].path).toBe('/v1/audio/voices')
    expect(voices.map((voice) => voice.id)).toEqual(['giong-1', 'giong-2'])
  })

  it('máy chủ không có endpoint giọng thì trả rỗng, không bịa danh sách', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 404, { error: 'not found' })

    const voices = await selfHostedOpenAiTtsAdapter.listVoices(context())

    // Rỗng để giao diện chuyển sang ô nhập tay. Bịa ra giọng không tồn tại trên
    // máy chủ của người dùng sẽ dẫn tới lỗi khó hiểu lúc tạo.
    expect(voices).toEqual([])
  })

  it('không có endpoint /models thì dùng tên model người dùng điền', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 404, { error: 'not found' })

    const models = await selfHostedOpenAiTtsAdapter.listModels(context({ model: 'omnivoice' }))

    expect(models).toHaveLength(1)
    expect(models[0].id).toBe('omnivoice')
  })

  it('có endpoint /models thì ưu tiên model người dùng chỉ định lên đầu', async () => {
    captured = []
    respond = (_request, response) =>
      sendJson(response, 200, { data: [{ id: 'khac' }, { id: 'omnivoice' }] })

    const models = await selfHostedOpenAiTtsAdapter.listModels(context({ model: 'omnivoice' }))

    expect(models.map((model) => model.id)).toEqual(['omnivoice', 'khac'])
  })

  it('thiếu /models KHÔNG bị coi là máy chủ hỏng', async () => {
    captured = []
    respond = (_request, response) => sendJson(response, 404, { error: 'not found' })

    const result = await selfHostedOpenAiTtsAdapter.testConnection(context())

    // Nhiều máy chủ TTS tự host chỉ cài đúng endpoint sinh audio. Kết luận
    // "không kết nối được" ở đây là sai và khiến người dùng đi sửa nhầm chỗ.
    expect(result.ok).toBe(true)
    expect(result.message).toContain('không có endpoint /models')
  })

  it('máy chủ tắt hẳn thì báo hỏng rõ ràng', async () => {
    // Cổng không có ai lắng nghe.
    const result = await selfHostedOpenAiTtsAdapter.testConnection({
      apiKey: '',
      config: { baseUrl: 'http://127.0.0.1:1/v1' },
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    expect(result.message.length).toBeGreaterThan(0)
  })

  it('chưa điền địa chỉ máy chủ thì nói thẳng, không thử gọi mạng', async () => {
    const result = await selfHostedOpenAiTtsAdapter.testConnection({
      apiKey: '',
      config: {},
      signal: new AbortController().signal
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('địa chỉ máy chủ')
  })

  it('khai báo danh mục giọng là nhập tay, không phải danh sách có sẵn', () => {
    expect(selfHostedOpenAiTtsAdapter.descriptor.voiceCatalog).toBe('manual')
    // Máy chủ tự host không bắt buộc khoá — bắt nhập sẽ chặn oan cấu hình hợp lệ.
    expect(selfHostedOpenAiTtsAdapter.descriptor.credentialRequired).toBe(false)
    expect(selfHostedOpenAiTtsAdapter.descriptor.configFields?.[0].key).toBe('baseUrl')
    expect(selfHostedOpenAiTtsAdapter.descriptor.configFields?.[0].required).toBe(true)
  })
})

describe('normaliseBaseUrl', () => {
  it('bỏ dấu gạch chéo thừa ở cuối', () => {
    expect(normaliseBaseUrl('http://localhost:8880/v1/')).toBe('http://localhost:8880/v1')
    expect(normaliseBaseUrl('http://localhost:8880/v1///')).toBe('http://localhost:8880/v1')
  })

  it('tự thêm http:// khi người dùng quên giao thức', () => {
    expect(normaliseBaseUrl('localhost:8880/v1')).toBe('http://localhost:8880/v1')
  })

  it('giữ nguyên https', () => {
    expect(normaliseBaseUrl('https://tts.noi-bo/v1')).toBe('https://tts.noi-bo/v1')
  })

  it('từ chối giao thức khác', () => {
    expect(() => normaliseBaseUrl('ftp://localhost/v1')).toThrow(/http hoặc https/)
  })
})
