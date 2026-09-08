import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/register-ipc-handlers'
import { startMcpServer, stopMcpServer } from './mcp/mcp-server'
import { rejectAllPending } from './mcp/mcp-renderer-bridge'
import { startLocalMediaServer, stopLocalMediaServer } from './media/local-media-server'
import { attachJobEventBridge, registerAiIpcHandlers } from './ipc/register-ai-ipc-handlers'
import { jobQueue } from './jobs/job-queue'
import {
  cancelAllModelDownloads,
  registerTranscriptionIpcHandlers
} from './ipc/register-transcription-ipc-handlers'
import {
  registerMediaProtocolHandler,
  registerMediaProtocolScheme
} from './media/media-protocol-handler'
import { ensureProjectsRoot } from './storage/workspace-paths'
import { cancelAllExports } from './export/export-manager'

/**
 * Tiến trình main: vòng đời ứng dụng, cửa sổ, và cầu nối tới hệ thống.
 *
 * Toàn bộ thao tác đĩa, tiến trình con ffmpeg và (về sau) khoá API của provider
 * đều nằm ở phía này. Renderer chạy sandbox và chỉ nói chuyện qua preload.
 */

// Phải đăng ký scheme TRƯỚC khi app sẵn sàng, nếu không đặc quyền stream không có hiệu lực.
registerMediaProtocolScheme()

/**
 * Cho phép trỏ thư mục dữ liệu sang chỗ khác.
 *
 * Kiểm thử đầu-cuối dùng biến này để chạy trên một hồ sơ trống, không đụng tới
 * dự án thật của người dùng. Cũng tiện khi cần chạy song song nhiều bản dev.
 */
const userDataOverride = process.env['AVS_USER_DATA_DIR']
if (userDataOverride) app.setPath('userData', userDataOverride)

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    // Bố cục đã được thiết kế để vẫn dùng được ở 1280x720 (DESCRIPTION §2).
    minWidth: 1120,
    minHeight: 680,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'AI Video Studio',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Trình dựng phim cần timer đều tay khi cửa sổ bị che một phần.
      backgroundThrottling: false
    }
  })

  window.on('ready-to-show', () => window.show())

  // Sự kiện job được đẩy tới đúng cửa sổ đã mở nó; ngắt kết nối khi cửa sổ đóng
  // để không gửi vào một webContents đã bị huỷ.
  const detachJobEvents = attachJobEventBridge(window.webContents)
  window.on('closed', detachJobEvents)

  window.webContents.setWindowOpenHandler(({ url }) => {
    // Link ngoài mở bằng trình duyệt hệ thống, không mở cửa sổ Electron mới.
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }

  return window
}

void app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.aivideostudio.app')

  registerMediaProtocolHandler()
  registerIpcHandlers()
  registerAiIpcHandlers()
  registerTranscriptionIpcHandlers()

  // Máy chủ MCP cho agent bên ngoài. Hỏng thì app vẫn phải chạy bình thường.
  void startMcpServer().catch(() => undefined)

  // Máy chủ media cho Remotion: bộ dựng khung hình là tiến trình riêng, không
  // đọc được đường dẫn đĩa nên phải phục vụ qua http.
  void startLocalMediaServer().catch(() => undefined)
  await ensureProjectsRoot()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('before-quit', () => {
  // Không để lại tiến trình ffmpeg mồ côi hay request đang bay khi người dùng thoát.
  cancelAllExports()
  cancelAllModelDownloads()
  jobQueue.cancelAll()
  // Agent bên ngoài đang chờ sẽ treo vĩnh viễn nếu không được từ chối tử tế.
  rejectAllPending('Ứng dụng đang thoát')
  void stopMcpServer()
  void stopLocalMediaServer()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
