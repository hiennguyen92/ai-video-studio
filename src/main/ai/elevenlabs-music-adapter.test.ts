import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { elevenLabsMusicAdapter, musicFileExtension } from './elevenlabs-music-adapter'

/**
 * Kiểm adapter sinh nhạc bằng MÁY CHỦ HTTP THẬT chạy tại chỗ.
 *
 * Điều đáng kiểm ở đây là những chi tiết giao thức mà đoán theo trí nhớ sẽ sai,
 * và sai thì chỉ lộ ra khi đã gọi thật và bị tính tiền:
 *
 *   - `output_format` phải nằm ở QUERY, không nằm trong body (khác endpoint TTS).
 *   - độ dài gửi đi là MILI GIÂY qua trường `music_length_ms`.
 *   - header xác thực là `xi-api-key`, không phải `Authorization: Bearer`.
 *
 * GIỚI HẠN (DESCRIPTION §10): máy chủ này chỉ nói đúng giao thức đã đọc trong tài
 * liệu. Nó KHÔNG chứng minh dịch vụ ElevenLabs thật hành xử như vậy — chưa có
 * khoá còn hiệu lực để kiểm.
 */

interface Captured {
  url: string
  apiKeyHeader?: string
  authorizationHeader?: string
  body: Record<string, unknown>
}

let server: Server
let baseUrl: string
let captured: Captured[] = []

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.url?.startsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify([{ model_id: 'music_v1' }, { model_id: 'music_v2' }]))
        return
      }

      const raw = Buffer.concat(chunks).toString('utf8')
      captured.push({
        url: request.url ?? '',
        apiKeyHeader: request.headers['xi-api-key'] as string | undefined,
        authorizationHeader: request.headers.authorization,
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      })

      response.writeHead(200, { 'Content-Type': 'audio/mpeg' })
      // Vài byte "audio" là đủ: phép thử này kiểm giao thức, không kiểm âm thanh.
      response.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Không mở được máy chủ thử')
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function context(apiKey = 'khoa-thu'): AdapterContext {
  captured = []
  return { apiKey, config: { baseUrl }, signal: new AbortController().signal }
}

const REQUEST = {
  model: 'music_v1',
  prompt: 'nhạc nền nhẹ nhàng cho video giới thiệu sản phẩm',
  durationSeconds: 30,
  parameters: {} as Record<string, number | string | boolean>
}

describe('elevenLabsMusicAdapter.generate', () => {
  it('gửi output_format ở QUERY, không nhét vào body', async () => {
    const ctx = context()
    await elevenLabsMusicAdapter.generate(ctx, {
      ...REQUEST,
      parameters: { output_format: 'mp3_44100_128' }
    })

    expect(captured[0].url).toBe('/music?output_format=mp3_44100_128')
    expect(captured[0].body.output_format).toBeUndefined()
  })

  it('đổi giây sang mili giây đúng tên trường của tài liệu', async () => {
    await elevenLabsMusicAdapter.generate(context(), REQUEST)

    expect(captured[0].body.music_length_ms).toBe(30_000)
    expect(captured[0].body.prompt).toContain('nhạc nền')
    expect(captured[0].body.model_id).toBe('music_v1')
  })

  it('xác thực bằng header xi-api-key, không phải Bearer', async () => {
    await elevenLabsMusicAdapter.generate(context('khoa-abc'), REQUEST)

    expect(captured[0].apiKeyHeader).toBe('khoa-abc')
    expect(captured[0].authorizationHeader).toBeUndefined()
  })

  it('chỉ gửi tham số tuỳ chọn khi người dùng thật sự đặt', async () => {
    await elevenLabsMusicAdapter.generate(context(), REQUEST)
    expect(captured[0].body.force_instrumental).toBeUndefined()
    expect(captured[0].body.seed).toBeUndefined()

    await elevenLabsMusicAdapter.generate(context(), {
      ...REQUEST,
      parameters: { force_instrumental: true, seed: 42 }
    })
    expect(captured[0].body.force_instrumental).toBe(true)
    expect(captured[0].body.seed).toBe(42)
  })

  it('chặn độ dài ngoài giới hạn tài liệu trước khi gọi mạng', async () => {
    for (const durationSeconds of [1, 700]) {
      const ctx = context()
      await expect(
        elevenLabsMusicAdapter.generate(ctx, { ...REQUEST, durationSeconds })
      ).rejects.toThrow(/Độ dài phải từ/)
      // Không được tốn một lượt gọi nào cho yêu cầu chắc chắn hỏng.
      expect(captured).toHaveLength(0)
    }
  })

  it('chặn mô tả rỗng', async () => {
    await expect(
      elevenLabsMusicAdapter.generate(context(), { ...REQUEST, prompt: '   ' })
    ).rejects.toThrow(/Chưa nhập mô tả/)
  })

  it('trả về audio kèm đuôi file đúng', async () => {
    const result = await elevenLabsMusicAdapter.generate(context(), REQUEST)
    expect(result.audio.byteLength).toBeGreaterThan(0)
    expect(result.fileExtension).toBe('mp3')
    expect(result.contentType).toContain('audio')
  })
})

describe('musicFileExtension', () => {
  it('suy đuôi file từ định dạng đã chọn', () => {
    expect(musicFileExtension('mp3_44100_128')).toBe('mp3')
    expect(musicFileExtension('opus_48000_64')).toBe('opus')
    expect(musicFileExtension('pcm_44100')).toBe('pcm')
    expect(musicFileExtension('ulaw_8000')).toBe('wav')
  })
})

describe('elevenLabsMusicAdapter.testConnection', () => {
  it('kiểm khoá bằng /models chứ không gọi /music (tránh tính tiền)', async () => {
    const result = await elevenLabsMusicAdapter.testConnection(context())

    expect(result.ok).toBe(true)
    // Không có lượt gọi nào tới /music.
    expect(captured).toHaveLength(0)
  })

  it('báo lỗi rõ ràng khi máy chủ không phản hồi', async () => {
    const result = await elevenLabsMusicAdapter.testConnection({
      apiKey: 'x',
      config: { baseUrl: 'http://127.0.0.1:1' },
      signal: new AbortController().signal
    })
    expect(result.ok).toBe(false)
    expect(result.message.length).toBeGreaterThan(0)
  }, 30_000)
})
