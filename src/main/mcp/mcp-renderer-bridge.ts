import { BrowserWindow } from 'electron'
import { IPC_EVENT } from '../../shared/ipc/ipc-contract'
import type { McpBridgeRequest, McpBridgeResponse } from '../../shared/ipc/ipc-contract'

/**
 * Cầu nối từ máy chủ MCP (tiến trình main) sang tài liệu project (renderer).
 *
 * Vì sao phải có cầu nối thay vì để main tự giữ document: **tài liệu chỉ có MỘT
 * nguồn sự thật**, và nguồn đó nằm ở renderer cùng với lịch sử hoàn tác. Nhân
 * bản sang main là tạo nguồn thứ hai — đúng thứ §4 cấm, và chắc chắn sẽ lệch
 * ngay lần đầu người dùng bấm Ctrl+Z.
 *
 * Nên main không đọc, không ghi. Nó HỎI renderer, và renderer trả lời bằng cùng
 * tập lệnh mà thao tác tay dùng.
 */

/** Agent bên ngoài không được chờ vô hạn khi cửa sổ treo. */
const REQUEST_TIMEOUT_MS = 30_000

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

const pending = new Map<string, Pending>()
let nextRequestId = 0

/** Cửa sổ đang dùng để hỏi. Không có cửa sổ nào thì không có project nào đang mở. */
function targetWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
  return windows.find((window) => window.isFocused()) ?? windows[0] ?? null
}

export function isRendererAvailable(): boolean {
  return targetWindow() !== null
}

export async function requestFromRenderer<T>(
  kind: McpBridgeRequest['kind'],
  payload: unknown
): Promise<T> {
  const window = targetWindow()
  if (!window) {
    throw new Error('Ứng dụng AI Video Studio chưa mở cửa sổ nào. Hãy mở app và mở một dự án.')
  }

  const requestId = `mcp_${(nextRequestId += 1)}`

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`Yêu cầu "${kind}" quá hạn ${REQUEST_TIMEOUT_MS / 1000}s`))
    }, REQUEST_TIMEOUT_MS)

    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer })
    window.webContents.send(IPC_EVENT.mcpRequest, { requestId, kind, payload } as McpBridgeRequest)
  })
}

/** Renderer gọi vào đây để trả lời. */
export function resolveRendererResponse(response: McpBridgeResponse): void {
  const entry = pending.get(response.requestId)
  // Trả lời muộn sau khi đã quá hạn là chuyện bình thường; bỏ qua, không báo lỗi.
  if (!entry) return

  pending.delete(response.requestId)
  clearTimeout(entry.timer)

  if (response.ok) entry.resolve(response.data)
  else entry.reject(new Error(response.error))
}

/** Huỷ mọi yêu cầu đang chờ khi thoát, tránh treo tiến trình. */
export function rejectAllPending(reason: string): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(new Error(reason))
  }
  pending.clear()
}
