import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Cấu hình máy chủ MCP, lưu theo MÁY chứ không theo dự án.
 *
 * Nằm ngoài file project cùng lý do với cấu hình provider: máy chủ cục bộ là
 * chuyện của máy này. Mở cùng một project trên máy khác thì lựa chọn ở đây vô
 * nghĩa.
 *
 * Đọc vào bộ nhớ một lần lúc khởi động rồi giữ đó: đường xử lý yêu cầu MCP hỏi
 * `requireToken` ở MỌI yêu cầu, mà đọc file mỗi lần thì vừa chậm vừa biến một
 * phép kiểm bảo mật thành thứ phụ thuộc vào đĩa.
 */

const CONFIG_FILE = 'mcp-config.json'

export interface McpConfig {
  /**
   * Có bắt buộc token ở header không.
   *
   * Mặc định BẬT. Tắt được vì có client MCP không gửi header tuỳ ý, nhưng tắt
   * nghĩa là mọi tiến trình trên máy đều sửa được dự án đang mở — nên giao diện
   * phải nói thẳng điều đó chứ không giấu.
   */
  requireToken: boolean
}

const DEFAULT_CONFIG: McpConfig = { requireToken: true }

let cached: McpConfig = { ...DEFAULT_CONFIG }

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

/** Nạp từ đĩa vào bộ nhớ. Gọi một lần lúc dựng máy chủ. */
export async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && 'requireToken' in parsed) {
      // Chỉ nhận đúng `false`: file hỏng, thiếu trường, hay ghi bậy đều phải rơi
      // về BẬT. Một lựa chọn bảo mật không được phép tắt vì đọc file thất bại.
      cached = { requireToken: (parsed as McpConfig).requireToken !== false }
    }
  } catch {
    cached = { ...DEFAULT_CONFIG }
  }
  return cached
}

/** Giá trị đang dùng. Đường xử lý yêu cầu gọi hàm này, không đọc đĩa. */
export function mcpConfig(): McpConfig {
  return cached
}

export async function setMcpRequireToken(requireToken: boolean): Promise<McpConfig> {
  cached = { requireToken }
  const target = configPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(cached, null, 2), 'utf8')
  await rename(temporary, target)
  return cached
}
