import type { AiTaskKind, ProviderDescriptor } from '../../shared/ai/ai-capability-types'
import type {
  MusicAdapter,
  SttAdapter,
  TranslateAdapter,
  TtsAdapter
} from '../../shared/ai/ai-provider-contracts'
import { edgeTtsAdapter } from './edge-tts-adapter'
import { elevenLabsTtsAdapter } from './elevenlabs-tts-adapter'
import { openAiTtsAdapter } from './openai-tts-adapter'
import { selfHostedOpenAiTtsAdapter } from './self-hosted-openai-tts-adapter'
import { whisperCppSttAdapter } from './whisper-cpp-stt-adapter'
import { openAiCompatibleTranslateAdapter } from './openai-compatible-translate-adapter'
import { elevenLabsMusicAdapter } from './elevenlabs-music-adapter'

/**
 * Sổ đăng ký provider.
 *
 * Thêm một provider mới nghĩa là thêm một dòng ở đây, không phải sửa giao diện:
 * màn hình Cấu hình AI dựng danh sách từ sổ này, còn các ô điều khiển thì dựng từ
 * khai báo năng lực của adapter.
 *
 * Một provider có thể làm nhiều tác vụ, nên danh sách mô tả được gộp theo id
 * chứ không nhân bản theo từng tác vụ.
 */

// Edge TTS đứng đầu vì nó là provider giọng đọc DUY NHẤT không cần khoá: máy mới
// cài chạy được ngay, và `defaultProviderForTask` lấy phần tử đầu tiên.
const TTS_ADAPTERS: TtsAdapter[] = [
  edgeTtsAdapter,
  elevenLabsTtsAdapter,
  openAiTtsAdapter,
  selfHostedOpenAiTtsAdapter
]

const STT_ADAPTERS: SttAdapter[] = [whisperCppSttAdapter]

const TRANSLATE_ADAPTERS: TranslateAdapter[] = [openAiCompatibleTranslateAdapter]

const MUSIC_ADAPTERS: MusicAdapter[] = [elevenLabsMusicAdapter]

export function listTtsAdapters(): TtsAdapter[] {
  return TTS_ADAPTERS
}

export function listSttAdapters(): SttAdapter[] {
  return STT_ADAPTERS
}

export function getSttAdapter(providerId: string): SttAdapter | undefined {
  return STT_ADAPTERS.find((adapter) => adapter.descriptor.id === providerId)
}

export function listTranslateAdapters(): TranslateAdapter[] {
  return TRANSLATE_ADAPTERS
}

export function getTranslateAdapter(providerId: string): TranslateAdapter | undefined {
  return TRANSLATE_ADAPTERS.find((adapter) => adapter.descriptor.id === providerId)
}

export function listMusicAdapters(): MusicAdapter[] {
  return MUSIC_ADAPTERS
}

export function getMusicAdapter(providerId: string): MusicAdapter | undefined {
  return MUSIC_ADAPTERS.find((adapter) => adapter.descriptor.id === providerId)
}

export function getTtsAdapter(providerId: string): TtsAdapter | undefined {
  return TTS_ADAPTERS.find((adapter) => adapter.descriptor.id === providerId)
}

/**
 * Phần chung mà mọi adapter đều có, đủ để màn hình Cấu hình AI làm việc.
 *
 * Các thao tác ở đó — kiểm tra kết nối, liệt kê model — không quan tâm provider
 * làm tác vụ gì. Tra riêng theo từng loại khiến provider chỉ làm phiên âm bị báo
 * "không có adapter" dù đã đăng ký đầy đủ.
 */
export type ConfigurableAdapter = Pick<TtsAdapter, 'descriptor' | 'listModels' | 'testConnection'>

export function getConfigurableAdapter(providerId: string): ConfigurableAdapter | undefined {
  return (
    getTtsAdapter(providerId) ??
    getSttAdapter(providerId) ??
    getTranslateAdapter(providerId) ??
    getMusicAdapter(providerId)
  )
}

/** Mô tả mọi provider đã biết, để giao diện dựng màn hình cài đặt mà không cần khoá. */
export function listProviderDescriptors(): ProviderDescriptor[] {
  const seen = new Map<string, ProviderDescriptor>()
  for (const adapter of [
    ...TTS_ADAPTERS,
    ...STT_ADAPTERS,
    ...TRANSLATE_ADAPTERS,
    ...MUSIC_ADAPTERS
  ]) {
    seen.set(adapter.descriptor.id, adapter.descriptor)
  }
  return [...seen.values()]
}

export function listProvidersForTask(task: AiTaskKind): ProviderDescriptor[] {
  return listProviderDescriptors().filter((descriptor) => descriptor.tasks.includes(task))
}

/** Provider mặc định cho một tác vụ khi người dùng chưa chọn gì. */
export function defaultProviderForTask(task: AiTaskKind): string | undefined {
  return listProvidersForTask(task)[0]?.id
}
