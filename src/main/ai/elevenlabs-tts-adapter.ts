import type {
  AdapterContext,
  TtsAdapter,
  TtsRequest,
  TtsResult,
  Voice
} from '../../shared/ai/ai-provider-contracts'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel,
  TtsCapabilities
} from '../../shared/ai/ai-capability-types'
import { requestBinary, requestJson } from './provider-http-client'

/**
 * Adapter ElevenLabs cho tác vụ sinh giọng đọc.
 *
 * Mọi endpoint, tên header và tên trường ở đây đều lấy từ tài liệu chính thức
 * (xem plans/research/researcher-04-tts-provider-api-verification.md), không viết
 * theo trí nhớ — DESCRIPTION §6 yêu cầu đúng điều này.
 *
 * Lưu ý về danh sách tham số: chỉ khai báo những tham số mà tài liệu ghi rõ
 * KHOẢNG GIÁ TRỊ. `style` và `speed` có tồn tại trong voice_settings nhưng khoảng
 * hợp lệ chưa xác minh được, nên tạm thời không đưa ra giao diện — bày một thanh
 * trượt không biết biên là mời người dùng gửi giá trị bị từ chối.
 */

const BASE_URL = 'https://api.elevenlabs.io'
const PROVIDER_ID = 'elevenlabs'

export const elevenLabsDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'ElevenLabs',
  tasks: ['tts'],
  credentialLabel: 'API key',
  credentialHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
  noteVi: 'Có endpoint liệt kê giọng nên danh sách giọng luôn lấy trực tiếp từ tài khoản của bạn.',
  noteEn: 'Exposes a voice-list endpoint, so voices are always read live from your account.'
}

/**
 * Giới hạn ký tự mỗi lần gọi, theo tài liệu ElevenLabs.
 * Tách khỏi danh sách model để `listModels` trả đúng hình dạng `ProviderModel`
 * mà không phải bỏ bớt trường.
 */
const MAX_CHARACTERS_BY_MODEL: Record<string, number> = {
  eleven_multilingual_v2: 10_000,
  eleven_flash_v2_5: 40_000,
  eleven_turbo_v2_5: 40_000,
  eleven_v3: 3_000
}

/** Model TTS theo tài liệu ElevenLabs. */
const MODELS: ProviderModel[] = [
  {
    id: 'eleven_multilingual_v2',
    label: 'Multilingual v2',
    languages: [],
    description: 'Chất lượng cao, đa ngôn ngữ'
  },
  {
    id: 'eleven_flash_v2_5',
    label: 'Flash v2.5',
    languages: [],
    description: 'Nhanh, độ trễ thấp'
  },
  {
    id: 'eleven_turbo_v2_5',
    label: 'Turbo v2.5',
    languages: [],
    description: 'Cân bằng tốc độ và chất lượng'
  },
  {
    id: 'eleven_v3',
    label: 'v3',
    languages: [],
    description: 'Biểu cảm nhất, giới hạn ký tự thấp'
  }
]

interface ElevenLabsVoice {
  voice_id: string
  name: string
  category?: string
  preview_url?: string
  description?: string
  labels?: Record<string, string>
  verified_languages?: Array<{ language?: string; locale?: string }>
}

interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[]
  has_more?: boolean
  next_page_token?: string
  total_count?: number
}

function authHeaders(context: AdapterContext): Record<string, string> {
  return { 'xi-api-key': context.apiKey }
}

export const elevenLabsTtsAdapter: TtsAdapter = {
  descriptor: elevenLabsDescriptor,

  capabilities(model: string): TtsCapabilities {

    return {
      voiceCatalog: 'remote',
      supportsLanguageFilter: true,
      supportsVoicePreviewSample: true,
      // Có endpoint kèm timestamp nhưng đường dẫn chính xác chưa xác minh được,
      // nên chưa khai báo là hỗ trợ.
      supportsTimestamps: false,
      maxCharactersPerRequest: MAX_CHARACTERS_BY_MODEL[model],
      parameters: [
        {
          key: 'stability',
          control: 'range',
          labelVi: 'Độ ổn định',
          labelEn: 'Stability',
          hintVi: 'Thấp thì giọng biểu cảm hơn nhưng dễ thay đổi giữa các lần tạo.',
          hintEn: 'Lower is more expressive but varies more between takes.',
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.5
        },
        {
          key: 'similarity_boost',
          control: 'range',
          labelVi: 'Độ giống giọng gốc',
          labelEn: 'Similarity boost',
          min: 0,
          max: 1,
          step: 0.05,
          defaultValue: 0.75
        },
        {
          key: 'use_speaker_boost',
          control: 'toggle',
          labelVi: 'Tăng cường giọng',
          labelEn: 'Speaker boost',
          defaultValue: true
        }
      ],
      outputFormats: [
        {
          value: 'mp3_44100_128',
          label: 'MP3 44.1 kHz 128 kbps',
          fileExtension: 'mp3',
          sampleRate: 44100
        },
        { value: 'wav_44100', label: 'WAV 44.1 kHz', fileExtension: 'wav', sampleRate: 44100 },
        { value: 'pcm_24000', label: 'PCM 24 kHz', fileExtension: 'pcm', sampleRate: 24000 }
      ]
    }
  },

  async listModels(): Promise<ProviderModel[]> {
    // Danh sách model là hằng số trong tài liệu, không có endpoint liệt kê nên
    // không tốn một lần gọi mạng chỉ để lấy thứ đã biết.
    return MODELS
  },

  async listVoices(context: AdapterContext, options): Promise<Voice[]> {
    const collected: Voice[] = []
    let pageToken: string | undefined

    // Có phân trang: tài khoản nhiều giọng sẽ không lộ hết trong một lần gọi.
    do {
      const url = new URL('/v2/voices', BASE_URL)
      url.searchParams.set('page_size', '100')
      if (pageToken) url.searchParams.set('next_page_token', pageToken)

      const response = await requestJson<ElevenLabsVoicesResponse>({
        url: url.toString(),
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID
      })

      for (const voice of response.voices ?? []) {
        const languages = (voice.verified_languages ?? [])
          .map((entry) => entry.language ?? entry.locale)
          .filter((value): value is string => Boolean(value))

        collected.push({
          id: voice.voice_id,
          name: voice.name,
          languages,
          previewUrl: voice.preview_url,
          description: voice.description,
          labels: voice.labels
        })
      }

      pageToken = response.has_more ? response.next_page_token : undefined
    } while (pageToken)

    if (!options?.language) return collected

    // Lọc phía ứng dụng: provider có công bố ngôn ngữ đã xác thực cho từng giọng,
    // nhưng giọng KHÔNG công bố gì thì vẫn giữ lại — loại bỏ chúng sẽ giấu mất
    // những giọng vẫn dùng được.
    const wanted = options.language.toLowerCase()
    return collected.filter(
      (voice) =>
        voice.languages.length === 0 ||
        voice.languages.some((language) => language.toLowerCase().startsWith(wanted))
    )
  },

  async synthesize(context: AdapterContext, request: TtsRequest): Promise<TtsResult> {
    const capabilities = this.capabilities(request.model)
    const limit = capabilities.maxCharactersPerRequest

    // Chặn ngay tại đây thay vì để provider trả 400: thông báo của mình nói rõ
    // vượt bao nhiêu, còn lỗi của provider thì không.
    if (limit && request.text.length > limit) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Đoạn văn bản dài ${request.text.length} ký tự, vượt giới hạn ${limit} của model ${request.model}. Hãy chia nhỏ kịch bản.`,
        retryable: false
      })
    }

    const format = capabilities.outputFormats.find((item) => item.value === request.outputFormat)
    if (!format) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Định dạng "${request.outputFormat}" không nằm trong danh sách hỗ trợ.`,
        retryable: false
      })
    }

    const url = new URL(`/v1/text-to-speech/${encodeURIComponent(request.voiceId)}`, BASE_URL)
    url.searchParams.set('output_format', request.outputFormat)

    const body: Record<string, unknown> = {
      text: request.text,
      model_id: request.model,
      voice_settings: request.parameters
    }
    if (request.language) body.language_code = request.language

    const binary = await requestBinary({
      url: url.toString(),
      method: 'POST',
      headers: { ...authHeaders(context), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: context.signal,
      providerId: PROVIDER_ID
    })

    return {
      audio: binary.bytes,
      contentType: binary.contentType,
      fileExtension: format.fileExtension
    }
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    try {
      // Liệt kê giọng là phép thử rẻ nhất: không sinh audio nên không tốn hạn mức.
      const url = new URL('/v2/voices', BASE_URL)
      url.searchParams.set('page_size', '1')

      const response = await requestJson<ElevenLabsVoicesResponse>({
        url: url.toString(),
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 15_000
      })

      const total = response.total_count ?? response.voices?.length ?? 0
      return {
        ok: true,
        message: 'Kết nối thành công',
        details: `Tài khoản có ${total} giọng đọc khả dụng`
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
