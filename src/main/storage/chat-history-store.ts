import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChatMessageRecord } from '../../shared/ipc/ipc-contract'
import { ensureProjectDirs, projectPaths } from './workspace-paths'

/**
 * Lịch sử hội thoại AI Chat, lưu THEO PROJECT (DESCRIPTION §5).
 *
 * Để trong file riêng cạnh `project.json` chứ không nhét vào tài liệu project, vì
 * hai lý do:
 *
 *   - hội thoại không phải nội dung biên tập, nên không được nằm trong hoàn tác;
 *     bấm Ctrl+Z mà mất một câu chat là hành vi vô lý.
 *   - nó chỉ dài thêm chứ không co lại, sẽ làm phình file project và làm chậm
 *     mọi lần tự lưu.
 *
 * Ghi theo kiểu nguyên tử giống project.json: ra file tạm rồi đổi tên đè lên.
 */

const CHAT_FILE = 'chat.json'

/** Cắt bớt lịch sử để file không phình vô hạn theo phiên làm việc dài. */
const MAX_STORED_MESSAGES = 400

function chatFilePath(projectId: string): string {
  return join(projectPaths(projectId).root, CHAT_FILE)
}

export async function readChatHistory(projectId: string): Promise<ChatMessageRecord[]> {
  try {
    const raw = await readFile(chatFilePath(projectId), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    // File có thể do bản cũ ghi hoặc bị sửa tay; lọc lấy phần còn dùng được thay
    // vì ném lỗi và làm mất cả lịch sử.
    return parsed.filter((entry): entry is ChatMessageRecord => {
      if (!entry || typeof entry !== 'object') return false
      const message = entry as Partial<ChatMessageRecord>
      return (
        typeof message.id === 'string' &&
        typeof message.content === 'string' &&
        (message.role === 'user' || message.role === 'assistant')
      )
    })
  } catch {
    // Chưa có file nghĩa là chưa từng chat — không phải lỗi.
    return []
  }
}

export async function writeChatHistory(
  projectId: string,
  messages: ChatMessageRecord[]
): Promise<void> {
  await ensureProjectDirs(projectId)
  const path = chatFilePath(projectId)
  const temporaryPath = `${path}.tmp`

  const trimmed = messages.slice(-MAX_STORED_MESSAGES)
  await writeFile(temporaryPath, JSON.stringify(trimmed), 'utf8')
  await rename(temporaryPath, path)
}

export async function clearChatHistory(projectId: string): Promise<void> {
  await writeChatHistory(projectId, [])
}
