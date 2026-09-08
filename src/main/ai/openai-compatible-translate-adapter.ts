import type {
  AdapterContext,
  TranslateAdapter,
  TranslateRequest,
  TranslateResult
} from '../../shared/ai/ai-provider-contracts'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel
} from '../../shared/ai/ai-capability-types'
import { normaliseBaseUrl } from '../secrets/provider-config-store'
import { requestJson } from './provider-http-client'
import {
  DEFAULT_TRANSLATION_BATCH_SIZE,
  buildTranslationMessages,
  chunkSegments
} from './translation-prompt-builder'
import { parseTranslationResponse } from './translation-response-parser'

/**
 * Dịch bằng máy chủ nói giao thức chat kiểu OpenAI.
 *
 * Một adapter dùng được cho Ollama, llama.cpp server, LM Studio, vLLM, LocalAI
 * và cả OpenAI — tất cả đều nhận `POST /v1/chat/completions` với cùng hình dạng
 * body. Người dùng đã tự host TTS thì cũng thường có sẵn một máy chủ LLM, nên
 * không bắt họ mở thêm tài khoản dịch vụ dịch thuật nào.
 *
 * Điểm khác biệt lớn nhất so với adapter TTS: kết quả của mô hình ngôn ngữ KHÔNG
 * đáng tin về cấu trúc. Adapter này vì vậy luôn kiểm lại liên kết theo id và hỏi
 * lại từng đoạn còn thiếu, thay vì tin vào lần trả lời đầu tiên.
 */

const PROVIDER_ID = 'openai-compatible-chat'

/** Cổng mặc định của Ollama; đây là máy chủ LLM local phổ biến nhất. */
const DEFAULT_BASE_URL = 'http://localhost:11434/v1'

/** Số lần hỏi lại các đoạn còn thiếu trước khi bỏ cuộc. */
const MAX_REPAIR_ROUNDS = 2

export const openAiCompatibleTranslateDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'Máy chủ LLM (OpenAI-compatible)',
  tasks: ['translate'],
  voiceCatalog: 'manual',
  // Máy chủ chạy trong máy thường không xác thực; OpenAI thì cần khoá.
  credentialRequired: false,
  credentialLabel: 'API key (nếu máy chủ yêu cầu)',
  credentialHelpUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  noteVi:
    'Dùng được với mọi máy chủ có POST /v1/chat/completions: Ollama, llama.cpp, LM Studio, vLLM, LocalAI, hoặc chính OpenAI. Chạy trong máy thì không tốn phí và nội dung không gửi ra ngoài.',
  noteEn:
    'Works with any server exposing POST /v1/chat/completions: Ollama, llama.cpp, LM Studio, vLLM, LocalAI, or OpenAI itself.',
  configFields: [
    {
      key: 'baseUrl',
      labelVi: 'Địa chỉ máy chủ',
      labelEn: 'Server address',
      placeholder: DEFAULT_BASE_URL,
      hintVi: 'Địa chỉ gốc có chứa /v1. Ollama mặc định là http://localhost:11434/v1',
      hintEn: 'Base URL including /v1. Ollama defaults to http://localhost:11434/v1',
      required: true,
      defaultValue: DEFAULT_BASE_URL
    },
    {
      key: 'model',
      labelVi: 'Tên model',
      labelEn: 'Model name',
      placeholder: 'qwen2.5:7b',
      hintVi:
        'Model càng lớn dịch càng sát. Model dưới 3B thường trả sai cấu trúc JSON và bị hỏi lại nhiều lần.',
      hintEn: 'Larger models translate better. Models under 3B often break the JSON contract.',
      required: false
    },
    {
      key: 'batchSize',
      labelVi: 'Số đoạn mỗi lượt',
      labelEn: 'Segments per request',
      placeholder: String(DEFAULT_TRANSLATION_BATCH_SIZE),
      hintVi: 'Lô lớn giữ ngữ cảnh tốt hơn nhưng mô hình hay bỏ sót đoạn cuối.',
      hintEn: 'Larger batches keep context but models tend to drop trailing segments.',
      required: false
    }
  ]
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

interface ModelListResponse {
  data?: Array<{ id?: string }>
}

function baseUrlOf(context: AdapterContext): string {
  const configured = context.config?.baseUrl?.trim()
  return normaliseBaseUrl(configured || DEFAULT_BASE_URL)
}

function headersFor(context: AdapterContext): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // Máy chủ local thường bỏ qua header này; gửi kèm khi có để dùng được với OpenAI.
  if (context.apiKey) headers.Authorization = `Bearer ${context.apiKey}`
  return headers
}

function modelOf(context: AdapterContext, requested: string): string {
  const model = requested?.trim() || context.config?.model?.trim()
  if (!model) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: PROVIDER_ID,
      message: 'Chưa chọn model. Vào Cấu hình AI để điền tên model.',
      retryable: false
    })
  }
  return model
}

/** Gọi một lượt chat và trả về phần văn bản thô. */
async function completeChat(
  context: AdapterContext,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const response = await requestJson<ChatCompletionResponse>({
    url: `${baseUrlOf(context)}/chat/completions`,
    method: 'POST',
    headers: headersFor(context),
    body: JSON.stringify({
      model,
      messages,
      // Dịch phụ đề cần bám sát bản gốc, không cần sáng tạo.
      temperature: 0.2,
      // Gợi ý chế độ JSON. Máy chủ nào không hiểu sẽ bỏ qua trường này, nên vẫn
      // phải tự bóc JSON ở lớp phân tích chứ không được tin hoàn toàn vào đây.
      response_format: { type: 'json_object' }
    }),
    signal: context.signal,
    providerId: PROVIDER_ID
  })

  const content = response.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new ProviderError({
      kind: 'server-error',
      providerId: PROVIDER_ID,
      message: 'Máy chủ trả về nội dung rỗng.'
    })
  }
  return content
}

export const openAiCompatibleTranslateAdapter: TranslateAdapter = {
  descriptor: openAiCompatibleTranslateDescriptor,

  async listModels(context: AdapterContext): Promise<ProviderModel[]> {
    const response = await requestJson<ModelListResponse>({
      url: `${baseUrlOf(context)}/models`,
      method: 'GET',
      headers: headersFor(context),
      signal: context.signal,
      providerId: PROVIDER_ID,
      timeoutMs: 15_000
    })

    return (response.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((id) => ({ id, label: id, languages: [] }))
  },

  async translate(context: AdapterContext, request: TranslateRequest): Promise<TranslateResult> {
    const model = modelOf(context, request.model)
    const configuredBatch = Number(context.config?.batchSize ?? '')
    const batchSize =
      Number.isFinite(configuredBatch) && configuredBatch > 0
        ? Math.floor(configuredBatch)
        : DEFAULT_TRANSLATION_BATCH_SIZE

    const batches = chunkSegments(request.segments, batchSize)
    const translated = new Map<string, string>()

    for (const [index, batch] of batches.entries()) {
      let pending = batch

      // Hỏi lại đúng những đoạn còn thiếu. Không suy ra theo thứ tự: đoán sai một
      // đoạn ở đây sẽ làm lệch phụ đề và lồng tiếng về sau.
      for (let round = 0; round <= MAX_REPAIR_ROUNDS && pending.length > 0; round += 1) {
        const messages = buildTranslationMessages({
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          glossary: request.glossary ?? [],
          segments: pending
        })

        const raw = await completeChat(context, model, messages)
        const parsed = parseTranslationResponse(
          raw,
          pending.map((segment) => segment.id)
        )

        for (const segment of parsed.segments) translated.set(segment.sourceSegmentId, segment.text)
        pending = pending.filter((segment) => !translated.has(segment.id))
      }

      context.onProgress?.((index + 1) / batches.length)
    }

    // Đoạn nào mô hình vẫn không dịch nổi thì GIỮ NGUYÊN bản gốc, không bỏ trống:
    // mất đoạn sẽ làm lệch liên kết với transcript.
    return {
      segments: request.segments.map((segment) => ({
        id: segment.id,
        text: translated.get(segment.id) ?? segment.text
      }))
    }
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    try {
      const models = await openAiCompatibleTranslateAdapter.listModels(context)
      const configured = context.config?.model?.trim()

      if (models.length === 0) {
        return {
          ok: false,
          message: 'Máy chủ trả lời nhưng chưa có model nào. Hãy tải model về trước.'
        }
      }
      // Nói thẳng khi tên model đã điền không có trên máy chủ: để tới lúc dịch
      // mới báo thì người dùng đã chờ xong cả một hàng đợi.
      if (configured && !models.some((entry) => entry.id === configured)) {
        return {
          ok: false,
          message: `Máy chủ không có model "${configured}".`,
          details: `Đang có: ${models.map((entry) => entry.id).join(', ')}`
        }
      }

      return {
        ok: true,
        message: 'Kết nối được máy chủ LLM',
        details: `${models.length} model · ${configured ?? models[0].id}`
      }
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, message: error.message }
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
