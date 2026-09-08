import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type { AdapterContext, Voice } from '../../shared/ai/ai-provider-contracts'
import { probeMediaFile } from '../media/media-probe'
import { elevenLabsTtsAdapter } from './elevenlabs-tts-adapter'

/**
 * Kiểm thử GỌI THẬT ElevenLabs.
 *
 * Chỉ chạy khi có biến môi trường `ELEVENLABS_API_KEY`; không có thì cả nhóm bị
 * bỏ qua, nên máy khác và CI không cần khoá vẫn chạy được toàn bộ test suite.
 *
 *   ELEVENLABS_API_KEY=... npx vitest run src/main/ai/elevenlabs-live
 *
 * Khoá KHÔNG bao giờ được viết vào mã nguồn hay file cấu hình trong repo.
 *
 * Đây là phép thử duy nhất chứng minh được điều mà fixture không chứng minh nổi:
 * phản hồi thật của provider có đúng như tài liệu mô tả không. Vì mỗi lần chạy
 * đều tốn hạn mức ký tự, câu thử được giữ thật ngắn.
 */

const apiKey = process.env.ELEVENLABS_API_KEY
const live = apiKey ? describe : describe.skip

/** Câu ngắn nhưng có đủ dấu thanh, dấu mũ và dấu móc của tiếng Việt. */
const VIETNAMESE_PHRASE = 'Xin chào, đây là bản thử nghiệm tiếng Việt.'

let workDir: string

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-live-tts-'))
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

function context(key = apiKey ?? ''): AdapterContext {
  return { apiKey: key, signal: new AbortController().signal }
}

live('ElevenLabs — gọi API thật', () => {
  let vietnameseModelId = ''
  /**
   * Khoá có thể bị giới hạn quyền. Quan sát thực tế: một khoá chỉ có
   * text_to_speech + models_read vẫn tạo giọng đọc bình thường nhưng không liệt
   * kê được giọng. Các phép thử liên quan tới giọng sẽ tự bỏ qua trong trường
   * hợp đó thay vì báo hỏng nhầm.
   */
  let voices: Voice[] = []
  let canListVoices = false

  it('kiểm tra kết nối thành công với khoá thật', async () => {
    const result = await elevenLabsTtsAdapter.testConnection(context())
    expect(result.ok).toBe(true)
    expect(result.details).toBeTruthy()
  }, 60_000)

  it('đọc danh sách model thật và biết model nào hỗ trợ tiếng Việt', async () => {
    const models = await elevenLabsTtsAdapter.listModels(context())
    expect(models.length).toBeGreaterThan(0)

    for (const model of models) {
      expect(typeof model.id).toBe('string')
      expect(Array.isArray(model.languages)).toBe(true)
    }

    const vietnamese = models.filter((model) =>
      model.languages.some((language) => language.toLowerCase().startsWith('vi'))
    )
    // Ít nhất một model phải đọc được tiếng Việt, nếu không cả sản phẩm mất ý nghĩa.
    expect(vietnamese.length).toBeGreaterThan(0)
    vietnameseModelId = vietnamese[0].id

    // Giới hạn ký tự phải đến từ API chứ không phải hằng số viết tay.
    const capabilities = elevenLabsTtsAdapter.capabilities(vietnameseModelId)
    expect(capabilities.maxCharactersPerRequest).toBeGreaterThan(0)
  }, 60_000)

  it('liệt kê giọng, hoặc báo thiếu quyền một cách rõ ràng', async () => {
    try {
      voices = await elevenLabsTtsAdapter.listVoices(context())
      canListVoices = true
    } catch (error) {
      const providerError = error as ProviderError
      // Thiếu quyền là tình huống hợp lệ và phải được phân loại đúng.
      expect(providerError.kind).toBe('insufficient-permission')
      expect(providerError.retryable).toBe(false)
      return
    }

    expect(voices.length).toBeGreaterThan(0)
    for (const voice of voices) {
      // Đây là những trường adapter dựa vào; thiếu là adapter hỏng lặng lẽ.
      expect(typeof voice.id).toBe('string')
      expect(voice.id.length).toBeGreaterThan(0)
      expect(typeof voice.name).toBe('string')
      expect(Array.isArray(voice.languages)).toBe(true)
      // Mã ngôn ngữ phải đã khử trùng lặp trước khi tới giao diện.
      expect(new Set(voice.languages).size).toBe(voice.languages.length)
    }
  }, 60_000)

  it('lọc theo tiếng Việt trả về tập con hợp lệ', async () => {
    if (!canListVoices) return

    const vietnamese = await elevenLabsTtsAdapter.listVoices(context(), { language: 'vi' })
    expect(vietnamese.length).toBeLessThanOrEqual(voices.length)
    for (const voice of vietnamese) {
      if (voice.languages.length > 0) {
        expect(voice.languages.some((language) => language.toLowerCase().startsWith('vi'))).toBe(
          true
        )
      }
    }
  }, 60_000)

  it('sinh audio tiếng Việt phát được và có thời lượng thật', async () => {
    // Chọn giọng "premade": quan sát thật cho thấy tài khoản gói miễn phí bị
    // chặn dùng giọng thư viện (category "professional") với HTTP 402.
    const usable = voices.find((voice) => voice.category === 'premade') ?? voices[0]
    const voiceId = usable?.id ?? process.env.ELEVENLABS_VOICE_ID
    if (!voiceId) {
      // Không có giọng nào để thử — bỏ qua thay vì báo hỏng, và nói rõ lý do.
      console.warn(
        'Bỏ qua phép thử sinh audio: khoá không liệt kê được giọng và chưa đặt ELEVENLABS_VOICE_ID.'
      )
      return
    }

    const result = await elevenLabsTtsAdapter.synthesize(context(), {
      model: vietnameseModelId || 'eleven_flash_v2_5',
      voiceId,
      text: VIETNAMESE_PHRASE,
      language: 'vi',
      parameters: { stability: 0.5, similarity_boost: 0.75 },
      outputFormat: 'mp3_44100_128'
    })

    expect(result.fileExtension).toBe('mp3')
    expect(result.contentType).toContain('audio')
    expect(result.audio.byteLength).toBeGreaterThan(1000)

    // Phép thử quyết định: ffprobe phải đọc được file như một audio hợp lệ.
    // Thời lượng ĐO ĐƯỢC này chính là thứ Mốc 3 dùng để phát hiện lồng tiếng tràn giờ.
    const audioPath = join(workDir, 'giong-doc-that.mp3')
    await writeFile(audioPath, result.audio)

    const { probe, kind } = await probeMediaFile(audioPath)
    expect(kind).toBe('audio')
    expect(probe.hasAudio).toBe(true)
    expect(probe.durationUs).toBeGreaterThan(500_000)
    expect(probe.durationUs).toBeLessThan(20_000_000)
  }, 120_000)

  it('khoá sai bị phân loại đúng là không đáng thử lại', async () => {
    const attempt = elevenLabsTtsAdapter.listModels(context('sk_khoa_sai_hoan_toan_khong_hop_le'))

    await expect(attempt).rejects.toThrow(ProviderError)
    try {
      await attempt
    } catch (error) {
      const providerError = error as ProviderError
      expect(providerError.kind).toBe('invalid-credential')
      expect(providerError.retryable).toBe(false)
    }
  }, 60_000)

  it('vượt giới hạn ký tự bị chặn trước khi tốn lượt gọi', async () => {
    const model = vietnameseModelId || 'eleven_flash_v2_5'
    const limit = elevenLabsTtsAdapter.capabilities(model).maxCharactersPerRequest ?? 5_000

    const attempt = elevenLabsTtsAdapter.synthesize(context(), {
      model,
      voiceId:
        voices.find((voice) => voice.category === 'premade')?.id ??
        process.env.ELEVENLABS_VOICE_ID ??
        'x',
      text: 'a'.repeat(limit + 500),
      parameters: {},
      outputFormat: 'mp3_44100_128'
    })
    await expect(attempt).rejects.toThrow(new RegExp(`vượt giới hạn ${limit}`))
  }, 30_000)
})
