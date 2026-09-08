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
 * Adapter OpenAI cho tác vụ sinh giọng đọc.
 *
 * Khác ElevenLabs ở một điểm quan trọng: OpenAI KHÔNG có endpoint liệt kê giọng.
 * Giọng là tập cố định ghi trong tài liệu, nên adapter khai báo
 * `voiceCatalog: 'static'` và giao diện phải nói rõ đây là danh mục cố định chứ
 * không phải danh sách lấy từ tài khoản.
 *
 * Tham số cũng phụ thuộc model: `instructions` chỉ dùng được với gpt-4o-mini-tts,
 * còn tts-1/tts-1-hd thì không. Vì vậy `capabilities()` nhận model làm tham số.
 */

const BASE_URL = 'https://api.openai.com/v1'
const PROVIDER_ID = 'openai'

/** Giới hạn cứng của endpoint speech, tính theo ký tự đầu vào. */
const MAX_CHARACTERS = 4096

export const openAiDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'OpenAI',
  tasks: ['tts'],
  voiceCatalog: 'static',
  credentialLabel: 'API key',
  credentialHelpUrl: 'https://platform.openai.com/api-keys',
  noteVi:
    'Không có endpoint liệt kê giọng — danh sách giọng là tập cố định theo tài liệu. Tài liệu không công bố mức độ hỗ trợ riêng cho tiếng Việt.',
  noteEn:
    'No voice-list endpoint — voices are a fixed documented set. The docs do not state Vietnamese support per voice.'
}

/** Giọng dùng được với MỌI model TTS. */
const BASE_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']

/** Giọng chỉ dùng được với model thế hệ mới, không dùng với tts-1/tts-1-hd. */
const EXTENDED_VOICES = ['ballad', 'verse', 'marin', 'cedar']

const LEGACY_MODELS = new Set(['tts-1', 'tts-1-hd'])

const MODELS: ProviderModel[] = [
  {
    id: 'gpt-4o-mini-tts',
    label: 'GPT-4o mini TTS',
    languages: [],
    description: 'Điều khiển được phong cách đọc'
  },
  { id: 'tts-1', label: 'TTS-1', languages: [], description: 'Độ trễ thấp' },
  { id: 'tts-1-hd', label: 'TTS-1 HD', languages: [], description: 'Chất lượng cao hơn' }
]

function authHeaders(context: AdapterContext): Record<string, string> {
  return { Authorization: `Bearer ${context.apiKey}` }
}

function voicesForModel(model: string): string[] {
  return LEGACY_MODELS.has(model) ? BASE_VOICES : [...BASE_VOICES, ...EXTENDED_VOICES]
}

export const openAiTtsAdapter: TtsAdapter = {
  descriptor: openAiDescriptor,

  capabilities(model: string): TtsCapabilities {
    const supportsInstructions = !LEGACY_MODELS.has(model)

    return {
      voiceCatalog: 'static',
      // Tài liệu không gắn ngôn ngữ cho từng giọng, nên không có gì để lọc.
      supportsLanguageFilter: false,
      // Giọng không có file mẫu qua API; muốn nghe thử phải sinh audio thật.
      supportsVoicePreviewSample: false,
      supportsTimestamps: false,
      maxCharactersPerRequest: MAX_CHARACTERS,
      parameters: [
        {
          key: 'speed',
          control: 'range',
          labelVi: 'Tốc độ đọc',
          labelEn: 'Speed',
          min: 0.25,
          max: 4,
          step: 0.05,
          defaultValue: 1
        },
        // Chỉ thêm ô hướng dẫn phong cách khi model thật sự nhận nó.
        ...(supportsInstructions
          ? [
              {
                key: 'instructions',
                control: 'select' as const,
                labelVi: 'Phong cách đọc',
                labelEn: 'Speaking style',
                hintVi: 'Chỉ khả dụng với model thế hệ mới.',
                hintEn: 'Only available on newer models.',
                options: [
                  { value: '', labelVi: 'Mặc định', labelEn: 'Default' },
                  { value: 'Đọc với giọng ấm áp, thân thiện.', labelVi: 'Ấm áp', labelEn: 'Warm' },
                  {
                    value: 'Đọc rõ ràng, trang trọng như bản tin.',
                    labelVi: 'Trang trọng',
                    labelEn: 'Formal'
                  },
                  {
                    value: 'Đọc nhiệt tình, nhiều năng lượng.',
                    labelVi: 'Nhiệt tình',
                    labelEn: 'Energetic'
                  },
                  { value: 'Đọc chậm rãi, nhẹ nhàng.', labelVi: 'Nhẹ nhàng', labelEn: 'Calm' }
                ],
                defaultValue: ''
              }
            ]
          : [])
      ],
      outputFormats: [
        { value: 'mp3', label: 'MP3', fileExtension: 'mp3' },
        { value: 'wav', label: 'WAV', fileExtension: 'wav' },
        { value: 'flac', label: 'FLAC', fileExtension: 'flac' },
        { value: 'opus', label: 'Opus', fileExtension: 'opus' },
        { value: 'aac', label: 'AAC', fileExtension: 'aac' }
      ]
    }
  },

  async listModels(): Promise<ProviderModel[]> {
    return MODELS
  },

  async listVoices(_context: AdapterContext, options): Promise<Voice[]> {
    void options
    // Danh mục cố định: không gọi mạng, và cũng không bịa thông tin ngôn ngữ mà
    // tài liệu không công bố — `languages` để rỗng đúng nghĩa "provider không nói".
    return voicesForModel('gpt-4o-mini-tts').map((name) => ({
      id: name,
      name,
      languages: []
    }))
  },

  async synthesize(context: AdapterContext, request: TtsRequest): Promise<TtsResult> {
    if (request.text.length > MAX_CHARACTERS) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Đoạn văn bản dài ${request.text.length} ký tự, vượt giới hạn ${MAX_CHARACTERS} của endpoint. Hãy chia nhỏ kịch bản.`,
        retryable: false
      })
    }

    const allowedVoices = voicesForModel(request.model)
    if (!allowedVoices.includes(request.voiceId)) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Giọng "${request.voiceId}" không dùng được với model ${request.model}.`,
        retryable: false
      })
    }

    const capabilities = this.capabilities(request.model)
    const format = capabilities.outputFormats.find((item) => item.value === request.outputFormat)
    if (!format) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Định dạng "${request.outputFormat}" không nằm trong danh sách hỗ trợ.`,
        retryable: false
      })
    }

    const body: Record<string, unknown> = {
      model: request.model,
      input: request.text,
      voice: request.voiceId,
      response_format: request.outputFormat
    }

    const speed = request.parameters.speed
    if (typeof speed === 'number' && speed !== 1) body.speed = speed

    const instructions = request.parameters.instructions
    // Chuỗi rỗng nghĩa là "mặc định" — không gửi trường này đi.
    if (typeof instructions === 'string' && instructions.length > 0) {
      body.instructions = instructions
    }

    const binary = await requestBinary({
      url: `${BASE_URL}/audio/speech`,
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
      // Liệt kê model là phép thử rẻ: xác thực được khoá mà không sinh audio.
      const response = await requestJson<{ data?: Array<{ id: string }> }>({
        url: `${BASE_URL}/models`,
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 15_000
      })

      return {
        ok: true,
        message: 'Kết nối thành công',
        details: `Khoá hợp lệ, truy cập được ${response.data?.length ?? 0} model`
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
