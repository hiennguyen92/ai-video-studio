import type { AiTaskKind, ProviderDescriptor } from '../../shared/ai/ai-capability-types'
import type { TtsAdapter } from '../../shared/ai/ai-provider-contracts'
import { elevenLabsTtsAdapter } from './elevenlabs-tts-adapter'
import { openAiTtsAdapter } from './openai-tts-adapter'
import { selfHostedOpenAiTtsAdapter } from './self-hosted-openai-tts-adapter'

/**
 * Sổ đăng ký provider.
 *
 * Thêm một provider mới nghĩa là thêm một dòng ở đây, không phải sửa giao diện:
 * màn hình Cấu hình AI dựng danh sách từ sổ này, còn các ô điều khiển thì dựng từ
 * khai báo năng lực của adapter.
 *
 * Hiện chỉ có TTS. STT, dịch và sinh nhạc sẽ được thêm ở mốc sau; interface của
 * chúng đã có sẵn trong `shared/ai/ai-provider-contracts.ts`.
 */

const TTS_ADAPTERS: TtsAdapter[] = [
  elevenLabsTtsAdapter,
  openAiTtsAdapter,
  selfHostedOpenAiTtsAdapter
]

export function listTtsAdapters(): TtsAdapter[] {
  return TTS_ADAPTERS
}

export function getTtsAdapter(providerId: string): TtsAdapter | undefined {
  return TTS_ADAPTERS.find((adapter) => adapter.descriptor.id === providerId)
}

/** Mô tả mọi provider đã biết, để giao diện dựng màn hình cài đặt mà không cần khoá. */
export function listProviderDescriptors(): ProviderDescriptor[] {
  const seen = new Map<string, ProviderDescriptor>()
  for (const adapter of TTS_ADAPTERS) {
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
