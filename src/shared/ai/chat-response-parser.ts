import { extractJsonBlock } from './model-json-extractor'

/**
 * Đọc câu trả lời của mô hình cho AI Chat.
 *
 * Cùng một bài học như bên dịch: mô hình hay bọc JSON trong khối ```json, thêm
 * câu dẫn nhập, hoặc trả về mỗi văn xuôi. Ở đây thêm một ràng buộc nữa — mảng
 * `toolCalls` phải là mảng thật, mỗi phần tử phải có `name` là chuỗi; phần tử nào
 * không đạt thì bỏ, không cố đoán ý.
 *
 * Không hiểu được thì coi như KHÔNG có công cụ nào được gọi và giữ nguyên văn bản
 * làm câu trả lời. Đoán bừa ở đây nghĩa là sửa nhầm dự án của người dùng.
 */

export interface ParsedChatResponse {
  reply: string
  toolCalls: Array<{ name: string; arguments: unknown }>
  /** Bật khi không bóc được JSON — nơi gọi sẽ hiện nguyên văn cho người dùng. */
  plainTextOnly: boolean
}

export function parseChatResponse(raw: string): ParsedChatResponse {
  const block = extractJsonBlock(raw)
  if (!block) return { reply: raw.trim(), toolCalls: [], plainTextOnly: true }

  let decoded: unknown
  try {
    decoded = JSON.parse(block)
  } catch {
    return { reply: raw.trim(), toolCalls: [], plainTextOnly: true }
  }

  if (!decoded || typeof decoded !== 'object') {
    return { reply: raw.trim(), toolCalls: [], plainTextOnly: true }
  }

  const record = decoded as Record<string, unknown>
  const reply = typeof record.reply === 'string' ? record.reply.trim() : ''

  const rawCalls = Array.isArray(record.toolCalls) ? record.toolCalls : []
  const toolCalls: Array<{ name: string; arguments: unknown }> = []

  for (const entry of rawCalls) {
    if (!entry || typeof entry !== 'object') continue
    const call = entry as Record<string, unknown>
    const name = typeof call.name === 'string' ? call.name : ''
    if (!name) continue
    // Tham số thiếu hẳn thì coi là object rỗng; schema của công cụ sẽ phán tiếp.
    toolCalls.push({ name, arguments: call.arguments ?? {} })
  }

  return {
    // JSON đúng dạng nhưng thiếu "reply" thì vẫn phải có gì đó để hiện.
    reply: reply || (toolCalls.length > 0 ? 'Đã chuẩn bị thay đổi.' : raw.trim()),
    toolCalls,
    plainTextOnly: false
  }
}
