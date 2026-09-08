import { describe, expect, it } from 'vitest'
import type { AdapterContext } from '../../shared/ai/ai-provider-contracts'
import { openAiCompatibleTranslateAdapter } from './openai-compatible-translate-adapter'

/**
 * Kiểm thử với MÔ HÌNH NGÔN NGỮ THẬT.
 *
 * Nhóm test kia dùng máy chủ dựng sẵn nên chỉ chứng minh giao thức đúng. Chỉ có
 * ở đây mới trả lời được câu hỏi thật sự quan trọng: một mô hình thật có chịu
 * giữ đúng liên kết theo id và tuân thủ glossary hay không.
 *
 * Cách chạy (ví dụ với Ollama):
 *
 *   brew install ollama && ollama serve
 *   ollama pull qwen2.5:7b
 *   LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=qwen2.5:7b \
 *     npx vitest run src/main/ai/openai-compatible-translate-live
 *
 * Không đặt biến môi trường thì cả nhóm bị bỏ qua.
 */

const baseUrl = process.env.LLM_BASE_URL
const model = process.env.LLM_MODEL
const live = baseUrl && model ? describe : describe.skip

function context(): AdapterContext {
  return {
    apiKey: process.env.LLM_API_KEY ?? '',
    config: { baseUrl: baseUrl ?? '', model: model ?? '' },
    signal: new AbortController().signal
  }
}

const SEGMENTS = [
  { id: 'seg_1', text: 'Drag the clip onto the timeline.' },
  { id: 'seg_2', text: 'Then press play to preview it.' },
  { id: 'seg_3', text: 'Export when you are happy with the result.' }
]

live('máy chủ LLM — chạy thật', () => {
  it('máy chủ có sẵn và model đã điền tồn tại', async () => {
    const result = await openAiCompatibleTranslateAdapter.testConnection(context())
    expect(result.ok).toBe(true)
  }, 60_000)

  it('dịch sang tiếng Việt và giữ đủ liên kết theo id', async () => {
    const result = await openAiCompatibleTranslateAdapter.translate(context(), {
      model: model as string,
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      segments: SEGMENTS
    })

    // Đúng số đoạn, đúng id, đúng thứ tự — bất biến sống còn của tính năng dịch.
    expect(result.segments.map((segment) => segment.id)).toEqual(['seg_1', 'seg_2', 'seg_3'])

    for (const [index, segment] of result.segments.entries()) {
      expect(segment.text.trim().length).toBeGreaterThan(0)
      // Bản dịch phải KHÁC bản gốc; giống hệt nghĩa là mô hình không dịch mà
      // adapter đã rơi vào nhánh giữ nguyên bản gốc.
      expect(segment.text).not.toBe(SEGMENTS[index].text)
    }
  }, 300_000)

  it('tuân thủ glossary với thuật ngữ đã khai', async () => {
    const result = await openAiCompatibleTranslateAdapter.translate(context(), {
      model: model as string,
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      segments: [{ id: 'seg_1', text: 'Drag the clip onto the timeline.' }],
      glossary: [{ from: 'timeline', to: 'dòng thời gian' }]
    })

    expect(result.segments[0].text.toLowerCase()).toContain('dòng thời gian')
  }, 300_000)
})
