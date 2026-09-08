import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { parseChatResponse } from '../../shared/ai/chat-response-parser'
import { getCredential } from '../secrets/credential-store'
import { getProviderConfig, normaliseBaseUrl } from '../secrets/provider-config-store'
import { requestJson } from './provider-http-client'

/**
 * Gọi mô hình ngôn ngữ cho AI Chat.
 *
 * Dùng LẠI đúng provider và đúng cấu hình của tab Dịch (DESCRIPTION §5: "Cấu hình
 * AI Studio và AI Chat phải dùng chung nguồn dữ liệu"). Người dùng khai địa chỉ
 * máy chủ một lần, cả hai chỗ cùng dùng.
 *
 * Ở đây KHÔNG có đường nào chạm vào tài liệu project: dịch vụ này chỉ trả về văn
 * bản và danh sách lời gọi công cụ chưa qua kiểm tra. Việc kiểm tra và dịch sang
 * lệnh sửa nằm ở renderer, nơi có tài liệu và tập lệnh.
 */

const PROVIDER_ID = 'openai-compatible-chat'

export interface ChatTurnRequest {
  systemPrompt: string
  /** Ngữ cảnh project đã tóm tắt, gửi như một lượt riêng. */
  projectContext: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userMessage: string
}

export interface ChatTurnResponse {
  reply: string
  toolCalls: Array<{ name: string; arguments: unknown }>
  plainTextOnly: boolean
  model: string
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

/** Số lượt hội thoại cũ gửi kèm. Gửi hết sẽ phình prompt và tốn tiền vô ích. */
const MAX_HISTORY_TURNS = 12

export async function runChatTurn(request: ChatTurnRequest): Promise<ChatTurnResponse> {
  const config = await getProviderConfig(PROVIDER_ID)
  const baseUrl = normaliseBaseUrl(config.baseUrl?.trim() || 'http://localhost:11434/v1')
  const model = config.model?.trim()

  if (!model) {
    throw new ProviderError({
      kind: 'bad-request',
      providerId: PROVIDER_ID,
      message: 'Chưa chọn model cho máy chủ LLM. Vào Cấu hình AI để điền.',
      retryable: false
    })
  }

  const apiKey = await getCredential(PROVIDER_ID)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  const messages = [
    { role: 'system', content: request.systemPrompt },
    // Ngữ cảnh đi riêng khỏi chỉ dẫn: mỗi lượt nó thay đổi, còn chỉ dẫn thì không.
    { role: 'system', content: `Current project state:\n${request.projectContext}` },
    ...request.history.slice(-MAX_HISTORY_TURNS),
    { role: 'user', content: request.userMessage }
  ]

  const response = await requestJson<ChatCompletionResponse>({
    url: `${baseUrl}/chat/completions`,
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      // Sửa video cần bám sát yêu cầu, không cần sáng tạo.
      temperature: 0.1,
      response_format: { type: 'json_object' }
    }),
    signal: new AbortController().signal,
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

  const parsed = parseChatResponse(content)
  return { ...parsed, model }
}
