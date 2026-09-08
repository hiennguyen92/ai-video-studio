import WebSocket from 'ws'
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
import { requestJson } from './provider-http-client'
import {
  EDGE_TTS_HEADERS,
  EDGE_TTS_VOICES_URL,
  buildConfigMessage,
  buildSocketUrl,
  buildSsml,
  buildSsmlMessage,
  parseBinaryMessage,
  textMessagePath
} from './edge-tts-protocol'

/**
 * Adapter đọc văn bản bằng dịch vụ của Microsoft Edge.
 *
 * Vì sao có: mọi provider giọng đọc còn lại đều cần khoá API và tính tiền. Cái
 * này không cần khoá nào cả, nên nó là đường DUY NHẤT để một máy mới cài chạy
 * được cả luồng dựng video aff mà không phải đăng ký gì.
 *
 * Đánh đổi phải nói rõ: đây là endpoint nội bộ của trình duyệt Edge, không có
 * tài liệu công khai và không có cam kết ổn định. Microsoft đổi giao thức lúc nào
 * cũng được. Chi tiết giao thức nằm ở `edge-tts-protocol.ts`, kèm số đo thật.
 */

const PROVIDER_ID = 'edge-tts'

export const edgeTtsDescriptor: ProviderDescriptor = {
  id: PROVIDER_ID,
  name: 'Microsoft Edge TTS (không cần khoá)',
  tasks: ['tts'],
  voiceCatalog: 'remote',
  credentialRequired: false,
  credentialLabel: 'Không cần khoá',
  credentialHelpUrl: 'https://github.com/rany2/edge-tts',
  noteVi:
    'Dùng dịch vụ đọc văn bản của trình duyệt Edge: không cần đăng ký, không tính tiền, nhưng là endpoint nội bộ nên Microsoft có thể đổi bất cứ lúc nào. Có 2 giọng tiếng Việt.',
  noteEn:
    'Uses the Microsoft Edge read-aloud service: no signup, no cost, but it is an internal endpoint that Microsoft can change at any time. Two Vietnamese voices.'
}

/**
 * Dịch vụ KHÔNG có khái niệm model — chỉ có giọng.
 *
 * Hợp đồng adapter vẫn đòi một danh sách model, nên trả về đúng một mục và nói
 * thẳng điều đó trong mô tả, thay vì bịa ra vài cái tên nghe như model.
 */
const SINGLE_MODEL: ProviderModel = {
  id: 'edge-neural',
  label: 'Edge Neural',
  languages: [],
  description: 'Dịch vụ không có lựa chọn model. Chất lượng giọng do chính giọng quyết định.'
}

interface EdgeVoiceEntry {
  Name: string
  ShortName: string
  Gender?: string
  Locale?: string
  LocaleName?: string
  FriendlyName?: string
  Status?: string
  VoiceTag?: { ContentCategories?: string[]; VoicePersonalities?: string[] }
}

/** Số nguyên người dùng chỉnh → chuỗi prosody luôn có dấu, ví dụ 0 → "+0%". */
function signed(value: number, unit: string): string {
  return `${value >= 0 ? '+' : ''}${Math.round(value)}${unit}`
}

function numberParameter(
  parameters: Record<string, number | string | boolean>,
  key: string
): number {
  const value = parameters[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Một lượt gọi: mở kết nối, gửi hai bản tin, gom audio tới `turn.end`. */
function synthesizeOnce(
  request: TtsRequest,
  ssml: string,
  signal: AbortSignal
): Promise<{ audio: Buffer; contentType?: string; completed: boolean }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(buildSocketUrl(), { headers: EDGE_TTS_HEADERS })
    const chunks: Buffer[] = []
    let contentType: string | undefined
    let settled = false
    // Máy chủ báo đọc xong bằng `turn.end`. Không thấy nó mà kết nối đã đóng nghĩa
    // là luồng bị cắt giữa chừng — quan sát thật: ra file MP3 mà ffprobe không
    // đọc nổi ("Could not seek"). Nhận bừa phần thu được sẽ ghi một câu đọc cụt
    // vào timeline, và chỉ lộ ra khi phát video.
    let completed = false

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      try {
        socket.close()
      } catch {
        // Kết nối có thể đã đóng sẵn; không có gì để dọn thêm.
      }
      if (error) reject(error)
      else resolve({ audio: Buffer.concat(chunks), contentType, completed })
    }

    const onAbort = (): void => finish(new Error('Đã huỷ'))
    signal.addEventListener('abort', onAbort, { once: true })

    socket.on('open', () => {
      socket.send(buildConfigMessage(request.outputFormat))
      socket.send(buildSsmlMessage(ssml))
    })

    socket.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const message = parseBinaryMessage(data)
        if (message.contentType) contentType = message.contentType
        if (message.path === 'audio') chunks.push(message.payload)
        return
      }
      if (textMessagePath(data.toString('utf8')) === 'turn.end') {
        completed = true
        finish()
      }
    })

    socket.on('error', (error: Error) => finish(error))
    // Đóng kết nối không phải lúc nào cũng là đọc xong; cờ `completed` phân biệt.
    socket.on('close', () => finish())
  })
}

export const edgeTtsAdapter: TtsAdapter = {
  descriptor: edgeTtsDescriptor,

  capabilities(): TtsCapabilities {
    return {
      voiceCatalog: 'remote',
      supportsLanguageFilter: true,
      // Danh sách giọng có sẵn mã ngôn ngữ nhưng không có file nghe thử.
      supportsVoicePreviewSample: false,
      // Dịch vụ có trả mốc thời gian theo từ, nhưng hợp đồng TtsResult chưa có
      // chỗ nhận, nên không bày ra như thể đã dùng được.
      supportsTimestamps: false,
      // Đo thật: 6.000 ký tự tiếng Việt (8.038 byte UTF-8) trong một lần gọi vẫn
      // ra audio đầy đủ. Giữ 5.000 cho có biên an toàn.
      //
      // Lần đo cũng cho thấy một điều quan trọng hơn con số: 2.500 ký tự TRƯỢT hai
      // lần liền rồi 6.000 ký tự lại chạy. Thất bại ở đây là chập chờn, không phải
      // theo độ dài — nên chỗ cần chắc chắn là logic thử lại bên dưới.
      maxCharactersPerRequest: 5_000,
      parameters: [
        {
          key: 'rate',
          control: 'range',
          labelVi: 'Tốc độ đọc',
          labelEn: 'Speaking rate',
          hintVi: 'Phần trăm so với tốc độ gốc. 0 là giữ nguyên.',
          hintEn: 'Percent relative to the default. 0 keeps it unchanged.',
          min: -50,
          max: 100,
          step: 5,
          defaultValue: 0
        },
        {
          key: 'pitch',
          control: 'range',
          labelVi: 'Cao độ (Hz)',
          labelEn: 'Pitch (Hz)',
          min: -50,
          max: 50,
          step: 5,
          defaultValue: 0
        },
        {
          key: 'volume',
          control: 'range',
          labelVi: 'Âm lượng',
          labelEn: 'Volume',
          min: -50,
          max: 50,
          step: 5,
          defaultValue: 0
        }
      ],
      // Chỉ những định dạng đã gọi thật và nhận được audio. Hai định dạng khác
      // trong tài liệu không chính thức (48 kHz mp3, riff PCM) luôn ra 0 byte.
      outputFormats: [
        {
          value: 'audio-24khz-48kbitrate-mono-mp3',
          label: 'MP3 24 kHz 48 kbps',
          fileExtension: 'mp3',
          sampleRate: 24000
        },
        {
          value: 'audio-24khz-96kbitrate-mono-mp3',
          label: 'MP3 24 kHz 96 kbps',
          fileExtension: 'mp3',
          sampleRate: 24000
        },
        {
          value: 'webm-24khz-16bit-mono-opus',
          label: 'WebM Opus 24 kHz',
          fileExtension: 'webm',
          sampleRate: 24000
        }
      ]
    }
  },

  async listModels(): Promise<ProviderModel[]> {
    return [SINGLE_MODEL]
  },

  async listVoices(context: AdapterContext, options): Promise<Voice[]> {
    const entries = await requestJson<EdgeVoiceEntry[]>({
      url: EDGE_TTS_VOICES_URL,
      method: 'GET',
      headers: EDGE_TTS_HEADERS,
      signal: context.signal,
      providerId: PROVIDER_ID,
      timeoutMs: 20_000
    })

    const voices: Voice[] = (entries ?? []).map((entry) => ({
      id: entry.ShortName,
      name: entry.FriendlyName ?? entry.ShortName,
      languages: entry.Locale ? [entry.Locale] : [],
      category: entry.Status,
      description: entry.LocaleName,
      labels: {
        ...(entry.Gender ? { gender: entry.Gender } : {}),
        ...(entry.VoiceTag?.VoicePersonalities?.length
          ? { personalities: entry.VoiceTag.VoicePersonalities.join(', ') }
          : {})
      }
    }))

    if (!options?.language) return voices

    // ĐÁNH DẤU rồi xếp lên trước, không lọc bỏ — cùng lý do như ElevenLabs: giọng
    // ngoài ngôn ngữ vẫn có thể là lựa chọn đúng, và ở đây tiếng Việt chỉ có 2
    // giọng nên lọc cứng làm màn hình chọn giọng gần như trống.
    const wanted = options.language.toLowerCase()
    return voices
      .map((voice) => ({
        ...voice,
        verifiedForLanguage: voice.languages.some((language) =>
          language.toLowerCase().startsWith(wanted)
        )
      }))
      .sort((a, b) => Number(b.verifiedForLanguage) - Number(a.verifiedForLanguage))
  },

  async synthesize(context: AdapterContext, request: TtsRequest): Promise<TtsResult> {
    const capabilities = this.capabilities(request.model)
    const limit = capabilities.maxCharactersPerRequest
    if (limit && request.text.length > limit) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Đoạn văn bản dài ${request.text.length} ký tự, vượt giới hạn ${limit} của Edge TTS. Hãy chia nhỏ kịch bản.`,
        retryable: false
      })
    }

    const format = capabilities.outputFormats.find((item) => item.value === request.outputFormat)
    if (!format) {
      throw new ProviderError({
        kind: 'bad-request',
        providerId: PROVIDER_ID,
        message: `Định dạng "${request.outputFormat}" không nằm trong danh sách đã kiểm chứng.`,
        retryable: false
      })
    }

    const ssml = buildSsml(request.voiceId, request.text, {
      rate: signed(numberParameter(request.parameters, 'rate'), '%'),
      pitch: signed(numberParameter(request.parameters, 'pitch'), 'Hz'),
      volume: signed(numberParameter(request.parameters, 'volume'), '%')
    })

    // Thử lại khi luồng KHÔNG TRỌN VẸN, không phải khi lỗi.
    //
    // Đo thật: cùng một yêu cầu hợp lệ thỉnh thoảng đóng kết nối sớm — có lần
    // không trả byte nào, có lần trả một phần rồi cắt, ra file MP3 mà ffprobe
    // không đọc nổi. Cả hai đều là hỏng im lặng: người dùng nhận một câu đọc cụt
    // hoặc một file rỗng làm giọng đọc, và chỉ phát hiện khi phát video.
    let lastError: Error | undefined
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const { audio, contentType, completed } = await synthesizeOnce(
          request,
          ssml,
          context.signal
        )
        if (completed && audio.length > 0) {
          return {
            audio: new Uint8Array(audio),
            contentType: contentType ?? 'audio/mpeg',
            fileExtension: format.fileExtension
          }
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (context.signal.aborted) break
      }
    }

    throw new ProviderError({
      kind: 'network',
      providerId: PROVIDER_ID,
      message: lastError
        ? `Edge TTS không trả về audio: ${lastError.message}`
        : 'Edge TTS đóng kết nối trước khi đọc xong, sau 3 lần thử.',
      retryable: true
    })
  },

  async testConnection(context: AdapterContext): Promise<ConnectionTestResult> {
    try {
      const voices = await this.listVoices(context)
      const vietnamese = voices.filter((voice) =>
        voice.languages.some((language) => language.toLowerCase().startsWith('vi'))
      )

      return {
        ok: true,
        message: 'Kết nối thành công',
        details: `${voices.length} giọng, ${vietnamese.length} giọng tiếng Việt`
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  }
}
