import type {
  AdapterContext,
  MusicAdapter,
  MusicRequest,
  MusicResult
} from '../../shared/ai/ai-provider-contracts'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel
} from '../../shared/ai/ai-capability-types'
import { requestBinary, requestJson } from './provider-http-client'

/**
 * Sinh nhạc nền bằng ElevenLabs Music.
 *
 * Chọn provider này vì nó là thứ duy nhất tìm được vừa có API công khai được ghi
 * tài liệu đầy đủ, vừa dùng lại đúng khoá mà người dùng đã có cho phần giọng đọc
 * — không phải mở thêm tài khoản dịch vụ nào (DESCRIPTION Mốc 4: "nếu tìm được
 * provider có API công khai ổn định").
 *
 * Hình dạng API dưới đây lấy từ TÀI LIỆU CHÍNH THỨC, không lấy theo trí nhớ:
 *
 *   POST https://api.elevenlabs.io/v1/music
 *   body : { prompt, music_length_ms, model_id, force_instrumental, seed? }
 *   query: output_format=<enum>
 *
 * Hai chi tiết dễ làm sai nếu đoán:
 *
 *   - `output_format` là THAM SỐ QUERY, không nằm trong body như phần TTS.
 *   - độ dài tính bằng MILI GIÂY (`music_length_ms`), giới hạn 3.000–600.000.
 *
 * ⚠️ CHƯA GỌI THẬT LẦN NÀO. Adapter mới chỉ được kiểm bằng máy chủ HTTP dựng tại
 * chỗ nói đúng giao thức này; chưa có khoá ElevenLabs còn hiệu lực để xác nhận
 * hành vi thật của dịch vụ.
 */

const PROVIDER_ID = 'elevenlabs-music'
const BASE_URL = 'https://api.elevenlabs.io/v1'

/** Giới hạn độ dài theo tài liệu: 3 giây tới 10 phút. */
export const MIN_MUSIC_LENGTH_MS = 3_000
export const MAX_MUSIC_LENGTH_MS = 600_000

export const elevenLabsMusicDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'ElevenLabs Music',
  tasks: ['music'],
  voiceCatalog: 'static',
  credentialRequired: true,
  credentialLabel: 'ElevenLabs API key',
  credentialHelpUrl: 'https://elevenlabs.io/app/settings/api-keys',
  noteVi:
    'Dùng chung khoá với phần giọng đọc ElevenLabs. Độ dài bài nhạc từ 3 giây tới 10 phút. Tính phí theo tài khoản của bạn.',
  noteEn:
    'Uses the same key as ElevenLabs voices. Track length from 3 seconds to 10 minutes. Billed to your account.',
  configFields: []
}

interface ModelListEntry {
  model_id?: string
  name?: string
}

/** Model nhạc theo tài liệu. Không lấy được từ API nên khai ở đây và ghi rõ nguồn. */
const MUSIC_MODELS: ProviderModel[] = [
  { id: 'music_v1', label: 'music_v1', languages: [] },
  { id: 'music_v2', label: 'music_v2', languages: [] }
]

function headersFor(context: AdapterContext): Record<string, string> {
  return { 'xi-api-key': context.apiKey, 'Content-Type': 'application/json' }
}

/**
 * Địa chỉ máy chủ. Mặc định là dịch vụ thật; cho phép trỏ đi chỗ khác để chạy
 * sau proxy của công ty, và để kiểm thử được giao thức mà không tốn tiền gọi thật.
 */
function baseUrlOf(context: AdapterContext): string {
  return context.config?.baseUrl?.trim() || BASE_URL
}

/** Đuôi file suy từ định dạng đã chọn, để asset có phần mở rộng đúng. */
export function musicFileExtension(outputFormat: string): string {
  if (outputFormat.startsWith('opus')) return 'opus'
  if (outputFormat.startsWith('pcm')) return 'pcm'
  if (outputFormat.startsWith('ulaw') || outputFormat.startsWith('alaw')) return 'wav'
  return 'mp3'
}

export const elevenLabsMusicAdapter: MusicAdapter = {
  descriptor: elevenLabsMusicDescriptor,

  async listModels(): Promise<ProviderModel[]> {
    return MUSIC_MODELS
  },

  async generate(context: AdapterContext, request: MusicRequest): Promise<MusicResult> {
    const prompt = request.prompt.trim()
    if (!prompt) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: 'Chưa nhập mô tả cho bản nhạc.',
        retryable: false
      })
    }

    const lengthMs = Math.round(request.durationSeconds * 1000)
    if (lengthMs < MIN_MUSIC_LENGTH_MS || lengthMs > MAX_MUSIC_LENGTH_MS) {
      // Chặn tại đây thay vì để provider trả 400 sau khi đã xếp hàng chờ.
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Độ dài phải từ ${MIN_MUSIC_LENGTH_MS / 1000} tới ${MAX_MUSIC_LENGTH_MS / 1000} giây.`,
        retryable: false
      })
    }

    const outputFormat =
      typeof request.parameters.output_format === 'string'
        ? request.parameters.output_format
        : 'mp3_44100_128'

    const body: Record<string, unknown> = {
      prompt,
      music_length_ms: lengthMs,
      model_id: request.model || 'music_v1'
    }
    if (typeof request.parameters.force_instrumental === 'boolean') {
      body.force_instrumental = request.parameters.force_instrumental
    }
    // Cùng seed cho ra cùng bản nhạc — hữu ích khi muốn tạo lại y hệt.
    if (typeof request.parameters.seed === 'number') body.seed = request.parameters.seed

    const result = await requestBinary({
      // output_format đi ở query, khác hẳn endpoint text-to-speech.
      url: `${baseUrlOf(context)}/music?output_format=${encodeURIComponent(outputFormat)}`,
      method: 'POST',
      headers: headersFor(context),
      body: JSON.stringify(body),
      signal: context.signal,
      providerId: PROVIDER_ID,
      // Sinh nhạc lâu hơn hẳn sinh giọng đọc.
      timeoutMs: 300_000
    })

    return {
      audio: result.bytes,
      contentType: result.contentType,
      fileExtension: musicFileExtension(outputFormat)
    }
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    try {
      // Dùng /models vì nó chỉ cần quyền models_read; gọi thẳng /music để thử
      // kết nối sẽ tính phí cho người dùng.
      const models = await requestJson<ModelListEntry[]>({
        url: `${baseUrlOf(context)}/models`,
        method: 'GET',
        headers: headersFor(context),
        signal: context.signal,
        providerId: PROVIDER_ID,
        timeoutMs: 20_000
      })

      return {
        ok: true,
        message: 'Khoá dùng được',
        details: `${Array.isArray(models) ? models.length : 0} model trong tài khoản`
      }
    } catch (error) {
      if (error instanceof ProviderError) return { ok: false, message: error.message }
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }
}
