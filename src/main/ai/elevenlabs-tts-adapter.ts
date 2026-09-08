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
  ProviderParameter,
  TtsCapabilities
} from '../../shared/ai/ai-capability-types'
import { requestBinary, requestJson } from './provider-http-client'

/**
 * Adapter ElevenLabs cho tác vụ sinh giọng đọc.
 *
 * Siêu dữ liệu model được ĐỌC TỪ `/v1/models`, không viết cứng trong mã. Quyết
 * định này đến từ việc chạy thật với khoá thật: bảng viết tay ban đầu — dựng
 * theo tài liệu — sai ở ba chỗ cùng lúc. `eleven_multilingual_v2` thực tế KHÔNG
 * có tiếng Việt trong danh sách ngôn ngữ, giới hạn ký tự của `eleven_v3` là
 * 5.000 chứ không phải 3.000, và mỗi model có cờ riêng cho biết có nhận `style`
 * hay `speaker_boost` hay không.
 *
 * Endpoint `/v1/models` chỉ cần quyền `models_read`, nhẹ hơn quyền đọc danh sách
 * giọng, nên nó cũng là phép thử kết nối tốt nhất.
 */

const BASE_URL = 'https://api.elevenlabs.io'
const PROVIDER_ID = 'elevenlabs'

export const elevenLabsDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'ElevenLabs',
  tasks: ['tts'],
  credentialLabel: 'API key',
  credentialHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
  noteVi:
    'Khoá cần quyền text_to_speech để tạo giọng, models_read để đọc model, và voices_read để liệt kê giọng.',
  noteEn:
    'The key needs text_to_speech to generate, models_read to read models, and voices_read to list voices.'
}

/* ── Hình dạng phản hồi thật của ElevenLabs ────────────────────── */

interface ElevenLabsLanguage {
  language_id?: string
  name?: string
}

interface ElevenLabsModel {
  model_id: string
  name?: string
  description?: string
  can_do_text_to_speech?: boolean
  can_use_style?: boolean
  can_use_speaker_boost?: boolean
  languages?: ElevenLabsLanguage[]
  maximum_text_length_per_request?: number
  max_characters_request_subscribed_user?: number
  max_characters_request_free_user?: number
}

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

/**
 * Nhớ siêu dữ liệu model giữa các lời gọi.
 *
 * `capabilities()` là hàm đồng bộ theo hợp đồng adapter, nhưng dữ liệu thật lại
 * đến từ mạng. Bộ nhớ đệm này do `listModels()` đổ đầy; nơi gọi luôn lấy danh
 * sách model trước khi hỏi năng lực.
 */
const modelCache = new Map<string, ElevenLabsModel>()

/** Dùng khi chưa kịp nạp model — cố tình dè dặt để không hứa quá. */
const CONSERVATIVE_CHARACTER_LIMIT = 5_000

function authHeaders(context: AdapterContext): Record<string, string> {
  return { 'xi-api-key': context.apiKey }
}

function characterLimitOf(model: ElevenLabsModel | undefined): number | undefined {
  if (!model) return undefined
  return (
    model.maximum_text_length_per_request ??
    model.max_characters_request_subscribed_user ??
    model.max_characters_request_free_user
  )
}

export const elevenLabsTtsAdapter: TtsAdapter = {
  descriptor: elevenLabsDescriptor,

  capabilities(model: string): TtsCapabilities {
    const cached = modelCache.get(model)

    const parameters: ProviderParameter[] = [
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
      }
    ]

    // Hai tham số dưới đây chỉ hiện khi CHÍNH MODEL nói là nhận chúng. Chưa nạp
    // được model thì không đoán bừa — thà thiếu còn hơn bày ô không có tác dụng.
    if (cached?.can_use_style) {
      parameters.push({
        key: 'style',
        control: 'range',
        labelVi: 'Cường độ phong cách',
        labelEn: 'Style exaggeration',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0
      })
    }
    if (cached?.can_use_speaker_boost) {
      parameters.push({
        key: 'use_speaker_boost',
        control: 'toggle',
        labelVi: 'Tăng cường giọng',
        labelEn: 'Speaker boost',
        defaultValue: true
      })
    }

    return {
      voiceCatalog: 'remote',
      supportsLanguageFilter: true,
      supportsVoicePreviewSample: true,
      // Có endpoint kèm timestamp nhưng đường dẫn chính xác chưa xác minh được.
      supportsTimestamps: false,
      maxCharactersPerRequest: characterLimitOf(cached) ?? CONSERVATIVE_CHARACTER_LIMIT,
      parameters,
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

  async listModels(context: AdapterContext): Promise<ProviderModel[]> {
    // Phản hồi là một MẢNG thuần, không bọc trong { models: [...] }.
    const response = await requestJson<ElevenLabsModel[]>({
      url: `${BASE_URL}/v1/models`,
      method: 'GET',
      headers: authHeaders(context),
      signal: context.signal,
      providerId: PROVIDER_ID,
      timeoutMs: 20_000
    })

    const ttsModels = (response ?? []).filter((model) => model.can_do_text_to_speech)
    modelCache.clear()
    for (const model of ttsModels) modelCache.set(model.model_id, model)

    return ttsModels.map((model) => {
      const languages = (model.languages ?? [])
        .map((language) => language.language_id)
        .filter((value): value is string => Boolean(value))

      return {
        id: model.model_id,
        label: model.name ?? model.model_id,
        // Danh sách ngôn ngữ do provider công bố — nguồn duy nhất đáng tin để
        // biết model nào thật sự đọc được tiếng Việt.
        languages,
        description: model.description
      }
    })
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
        // `verified_languages` trả về THEO TỪNG BẢN GHI xác thực, nên cùng một mã
        // ngôn ngữ lặp lại nhiều lần (quan sát thật: "en" xuất hiện 9 lần cho một
        // giọng). Không khử trùng lặp thì ô chọn giọng hiện ra "(en, en, en, …)".
        const languages = [
          ...new Set(
            (voice.verified_languages ?? [])
              .map((entry) => entry.language ?? entry.locale)
              .filter((value): value is string => Boolean(value))
          )
        ]

        collected.push({
          id: voice.voice_id,
          name: voice.name,
          languages,
          category: voice.category,
          previewUrl: voice.preview_url,
          description: voice.description,
          labels: voice.labels
        })
      }

      pageToken = response.has_more ? response.next_page_token : undefined
    } while (pageToken)

    if (!options?.language) return collected

    // Giọng KHÔNG công bố ngôn ngữ nào thì vẫn giữ lại — loại bỏ chúng sẽ giấu
    // mất những giọng vẫn dùng được.
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
      // Dùng /v1/models chứ không dùng danh sách giọng: nó chỉ cần quyền
      // models_read. Quan sát thực tế cho thấy một khoá chỉ có quyền
      // text_to_speech vẫn tạo giọng đọc bình thường nhưng không liệt kê được
      // giọng — thử kết nối bằng endpoint giọng sẽ báo hỏng nhầm cho khoá đó.
      const models = await this.listModels(context)
      const vietnamese = models.filter((model) =>
        model.languages.some((language) => language.toLowerCase().startsWith('vi'))
      )

      return {
        ok: true,
        message: 'Kết nối thành công',
        details: `${models.length} model sinh giọng đọc, ${vietnamese.length} model hỗ trợ tiếng Việt`
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

/** Chỉ dùng trong kiểm thử: xoá bộ nhớ đệm model giữa các phép thử. */
export function clearElevenLabsModelCache(): void {
  modelCache.clear()
}
