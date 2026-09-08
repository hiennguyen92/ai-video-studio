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
import { normaliseBaseUrl } from '../secrets/provider-config-store'
import { requestBinary, requestJson } from './provider-http-client'

/**
 * Adapter cho MÁY CHỦ TTS TỰ HOST nói giao thức kiểu OpenAI.
 *
 * Vì sao một adapter chung thay vì adapter riêng cho từng dự án: `POST
 * /v1/audio/speech` đã thành chuẩn de-facto của hệ sinh thái tự host. Ít nhất
 * bảy dự án dùng chung hình dạng này — omnivoice-server (bọc k2-fsa/OmniVoice),
 * Piper HTTP server, Coqui XTTS, openedai-speech, Kokoro FastAPI, silero,
 * open-unified-tts. Viết bảy adapter gần giống nhau là nhân bản lỗi bảy lần.
 *
 * Chỗ các dự án KHÔNG thống nhất là phần nhân bản giọng (`ref_audio` hay
 * `speaker_id` hay đường dẫn file) và endpoint liệt kê giọng. Adapter này vì vậy
 * chỉ cam kết phần lõi mà tất cả đều có — model, input, voice, response_format,
 * speed — và để người dùng tự nhập tên giọng thay vì bịa ra một danh sách.
 *
 * Với OmniVoice, cách chạy đã kiểm chứng được từ tài liệu:
 *   pip install omnivoice-server && omnivoice-server   # http://localhost:8880
 * rồi điền địa chỉ đó vào ô "Địa chỉ máy chủ" trong Cấu hình AI.
 */

const PROVIDER_ID = 'self-hosted-openai'

/** Mặc định trỏ tới cổng omnivoice-server công bố trong tài liệu. */
const DEFAULT_BASE_URL = 'http://localhost:8880/v1'

export const selfHostedOpenAiDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'Máy chủ tự host (OpenAI-compatible)',
  tasks: ['tts'],
  voiceCatalog: 'manual',
  // Máy chủ chạy trong máy thường không có xác thực.
  credentialRequired: false,
  credentialLabel: 'API key (nếu máy chủ yêu cầu)',
  credentialHelpUrl: 'https://github.com/maemreyo/omnivoice-server',
  noteVi:
    'Dùng được với mọi máy chủ có POST /v1/audio/speech: omnivoice-server, Piper, Coqui XTTS, openedai-speech, Kokoro… Máy chủ chạy trong máy bạn nên không tốn phí gọi API.',
  noteEn:
    'Works with any server exposing POST /v1/audio/speech: omnivoice-server, Piper, Coqui XTTS, openedai-speech, Kokoro, and others.',
  configFields: [
    {
      key: 'baseUrl',
      labelVi: 'Địa chỉ máy chủ',
      labelEn: 'Server address',
      placeholder: DEFAULT_BASE_URL,
      hintVi: 'Địa chỉ gốc có chứa /v1. Với omnivoice-server mặc định là http://localhost:8880/v1',
      hintEn: 'Base URL including /v1. omnivoice-server defaults to http://localhost:8880/v1',
      required: true,
      defaultValue: DEFAULT_BASE_URL
    },
    {
      key: 'model',
      labelVi: 'Tên model',
      labelEn: 'Model name',
      placeholder: 'omnivoice',
      hintVi: 'Giá trị gửi ở trường "model". Mỗi máy chủ đặt tên khác nhau.',
      hintEn: 'Sent as the "model" field. Each server names this differently.',
      required: false,
      defaultValue: 'omnivoice'
    },
    {
      key: 'voices',
      labelVi: 'Danh sách giọng',
      labelEn: 'Voice list',
      placeholder: 'alloy, nova, vi-female',
      hintVi:
        'Ngăn cách bằng dấu phẩy. Để trống nếu máy chủ có endpoint liệt kê giọng — ứng dụng sẽ tự dò.',
      hintEn: 'Comma separated. Leave empty if the server exposes a voice-list endpoint.',
      required: false
    }
  ]
}

function baseUrlOf(context: AdapterContext): string {
  const raw = context.config?.baseUrl?.trim()
  if (!raw) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: PROVIDER_ID,
      message: 'Chưa điền địa chỉ máy chủ. Vào Cấu hình AI để nhập.',
      retryable: false
    })
  }
  return normaliseBaseUrl(raw)
}

/** Máy chủ tự host thường không cần xác thực; chỉ gửi header khi có khoá. */
function authHeaders(context: AdapterContext): Record<string, string> {
  return context.apiKey ? { Authorization: `Bearer ${context.apiKey}` } : {}
}

function configuredVoices(context: AdapterContext): string[] {
  return (context.config?.voices ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export const selfHostedOpenAiTtsAdapter: TtsAdapter = {
  descriptor: selfHostedOpenAiDescriptor,

  capabilities(): TtsCapabilities {
    return {
      voiceCatalog: 'manual',
      // Máy chủ không công bố ngôn ngữ của từng giọng.
      supportsLanguageFilter: false,
      supportsVoicePreviewSample: false,
      supportsTimestamps: false,
      // Không giới hạn ký tự cứng: máy chủ chạy trong máy, và mỗi bản cài một khác.
      // Việc chia đoạn kịch bản vẫn theo mức làm việc mặc định.
      maxCharactersPerRequest: undefined,
      parameters: [
        {
          key: 'speed',
          control: 'range',
          labelVi: 'Tốc độ đọc',
          labelEn: 'Speed',
          hintVi: 'Máy chủ có thể bỏ qua tham số này nếu không hỗ trợ.',
          hintEn: 'The server may ignore this if unsupported.',
          min: 0.25,
          max: 4,
          step: 0.05,
          defaultValue: 1
        }
      ],
      outputFormats: [
        { value: 'wav', label: 'WAV', fileExtension: 'wav' },
        { value: 'mp3', label: 'MP3', fileExtension: 'mp3' },
        { value: 'opus', label: 'Opus', fileExtension: 'opus' },
        { value: 'flac', label: 'FLAC', fileExtension: 'flac' }
      ]
    }
  },

  async listModels(context: AdapterContext): Promise<ProviderModel[]> {
    const configured = context.config?.model?.trim() || 'omnivoice'
    const fallback: ProviderModel[] = [{ id: configured, label: configured, languages: [] }]

    // Thử endpoint liệt kê model; nhiều máy chủ tự host có, nhiều máy chủ không.
    // Không có thì dùng tên model người dùng đã điền — không coi là lỗi.
    try {
      const response = await requestJson<{ data?: Array<{ id?: string }> }>({
        url: `${baseUrlOf(context)}/models`,
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 10_000
      })

      const models = (response.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
      if (models.length === 0) return fallback

      // Giữ model người dùng chỉ định ở đầu nếu máy chủ cũng liệt kê nó.
      const ordered = models.includes(configured)
        ? [configured, ...models.filter((id) => id !== configured)]
        : models
      return ordered.map((id) => ({ id, label: id, languages: [] }))
    } catch {
      return fallback
    }
  },

  async listVoices(context: AdapterContext): Promise<Voice[]> {
    const configured = configuredVoices(context)
    if (configured.length > 0) {
      return configured.map((name) => ({ id: name, name, languages: [] }))
    }

    // Thử dò endpoint liệt kê giọng. Không có chuẩn chung cho phần này, nên chỉ
    // thử một đường dẫn phổ biến rồi thôi — không đoán thêm.
    try {
      const response = await requestJson<{ voices?: unknown }>({
        url: `${baseUrlOf(context)}/audio/voices`,
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 10_000
      })

      const raw = response.voices
      if (Array.isArray(raw)) {
        const names = raw
          .map((entry) =>
            typeof entry === 'string'
              ? entry
              : ((entry as { id?: string; name?: string })?.id ??
                (entry as { name?: string })?.name)
          )
          .filter((name): name is string => Boolean(name))
        if (names.length > 0) return names.map((name) => ({ id: name, name, languages: [] }))
      }
    } catch {
      // Máy chủ không có endpoint này — chuyện bình thường.
    }

    // Không dò được thì trả rỗng để giao diện chuyển sang ô nhập tay, thay vì
    // bịa ra một danh sách giọng không tồn tại trên máy chủ của người dùng.
    return []
  },

  async synthesize(context: AdapterContext, request: TtsRequest): Promise<TtsResult> {
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
      model: request.model || context.config?.model || 'omnivoice',
      input: request.text,
      response_format: request.outputFormat
    }
    // Chỉ gửi `voice` khi người dùng thật sự chỉ định: một số máy chủ từ chối
    // giọng rỗng, số khác lại dùng giọng mặc định khi vắng trường này.
    if (request.voiceId) body.voice = request.voiceId

    const speed = request.parameters.speed
    if (typeof speed === 'number' && speed !== 1) body.speed = speed

    const binary = await requestBinary({
      url: `${baseUrlOf(context)}/audio/speech`,
      method: 'POST',
      headers: { ...authHeaders(context), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: context.signal,
      providerId: PROVIDER_ID,
      // Máy chủ tự host phải nạp model ở lần gọi đầu, có khi mất hàng chục giây.
      timeoutMs: 300_000
    })

    return {
      audio: binary.bytes,
      contentType: binary.contentType,
      fileExtension: format.fileExtension
    }
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    let baseUrl: string
    try {
      baseUrl = baseUrlOf(context)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }

    try {
      const response = await requestJson<{ data?: Array<{ id?: string }> }>({
        url: `${baseUrl}/models`,
        method: 'GET',
        headers: authHeaders(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 15_000
      })
      const count = response.data?.length ?? 0
      return {
        ok: true,
        message: 'Kết nối được tới máy chủ',
        details: count > 0 ? `Máy chủ báo có ${count} model` : 'Máy chủ phản hồi'
      }
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null

      // Không có /models KHÔNG có nghĩa là máy chủ hỏng: nhiều máy chủ TTS tự
      // host chỉ cài đúng endpoint sinh audio. Nói rõ thay vì kết luận sai.
      if (providerError?.status === 404) {
        return {
          ok: true,
          message: 'Máy chủ phản hồi nhưng không có endpoint /models',
          details: 'Có thể vẫn dùng được. Hãy thử tạo một đoạn giọng đọc để xác nhận.'
        }
      }

      return {
        ok: false,
        message: providerError?.message ?? (error instanceof Error ? error.message : String(error))
      }
    }
  }
}
