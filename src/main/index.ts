import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { registerIpcHandlers } from './ipc/register-ipc-handlers'
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
  // Không để lại tiến trình ffmpeg mồ côi khi người dùng thoát giữa lúc đang xuất.
  cancelAllExports()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
