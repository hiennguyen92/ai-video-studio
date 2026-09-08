import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Bản thay thế module `electron` khi chạy kiểm thử.
 *
 * Mã ở tiến trình main import `electron` để hỏi đường dẫn thư mục dữ liệu và để
 * mã hoá bí mật. Trong vitest không có runtime Electron, nên `vitest.config.ts`
 * ánh xạ `electron` sang file này.
 *
 * Đây là bản thay thế cho HẠ TẦNG chạy, không phải bản giả lập cho logic đang
 * kiểm thử: thư mục thật vẫn được tạo, file thật vẫn được ghi. Điều duy nhất bị
 * thay là nguồn cung cấp đường dẫn.
 */

const testUserData = mkdtempSync(join(tmpdir(), 'avs-test-userdata-'))

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return testUserData
    if (name === 'videos') return join(testUserData, 'videos')
    return join(testUserData, name)
  },
  getVersion: () => '0.0.0-test',
  getLocale: () => 'vi-VN',
  setPath: () => undefined,
  on: () => undefined,
  whenReady: async () => undefined
}

/**
 * safeStorage giả lập bằng phép đảo byte, KHÔNG phải mã hoá.
 * Chỉ dùng để kiểm tra luồng lưu/đọc; không bao giờ chạy trong bản phát hành.
 */
export const safeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'test',
  encryptString(value: string): Buffer {
    return Buffer.from(value, 'utf8').map((byte) => byte ^ 0x5a)
  },
  decryptString(buffer: Buffer): string {
    return Buffer.from(buffer)
      .map((byte) => byte ^ 0x5a)
      .toString('utf8')
  }
}

export const ipcMain = { handle: () => undefined, on: () => undefined }
export const dialog = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
export const net = { fetch: async () => new Response(null, { status: 404 }) }
export const protocol = { handle: () => undefined, registerSchemesAsPrivileged: () => undefined }
export const shell = { openExternal: async () => undefined }

export default { app, safeStorage, ipcMain, dialog, net, protocol, shell }
