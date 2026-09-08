import { app, safeStorage } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Lưu khoá API của provider.
 *
 * Khoá được mã hoá bằng `safeStorage` của Electron, tức là Keychain trên macOS,
 * DPAPI trên Windows, libsecret/kwallet trên Linux. Bản mã hoá nằm trong thư mục
 * dữ liệu ứng dụng, KHÔNG nằm trong file project.
 *
 * Quy tắc bất di bất dịch (DESCRIPTION §6): khoá không bao giờ rời khỏi tiến
 * trình main. Renderer chỉ hỏi được "provider này đã có khoá chưa", không bao giờ
 * lấy được giá trị. Vì vậy ở đây không có hàm nào trả khoá qua IPC.
 *
 * Khoá cũng không được đi vào log: mọi thông báo lỗi trong file này chỉ nhắc tới
 * id của provider.
 */

const CREDENTIALS_FILE = 'provider-credentials.json'

/** providerId -> khoá đã mã hoá, mã hoá base64 để nhét vừa JSON. */
type CredentialFile = Record<string, string>

function credentialsPath(): string {
  return join(app.getPath('userData'), CREDENTIALS_FILE)
}

async function readCredentialFile(): Promise<CredentialFile> {
  try {
    const raw = await readFile(credentialsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as CredentialFile
  } catch {
    // Chưa có file, hoặc file hỏng — coi như chưa lưu khoá nào.
    return {}
  }
}

async function writeCredentialFile(data: CredentialFile): Promise<void> {
  const target = credentialsPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

export interface EncryptionStatus {
  available: boolean
  /** Tên kho bí mật đang dùng, hiển thị trong phần cài đặt. */
  backend: string
}

/**
 * Trên Linux, safeStorage có thể rơi về chế độ mã hoá yếu khi không tìm thấy
 * kho bí mật của desktop. Người dùng cần biết điều đó trước khi nhập khoá.
 */
export function encryptionStatus(): EncryptionStatus {
  const available = safeStorage.isEncryptionAvailable()
  let backend = available ? 'OS keychain' : 'không khả dụng'

  if (process.platform === 'linux' && available) {
    try {
      backend = safeStorage.getSelectedStorageBackend()
    } catch {
      backend = 'unknown'
    }
  } else if (available) {
    backend = process.platform === 'darwin' ? 'macOS Keychain' : 'Windows DPAPI'
  }

  return { available, backend }
}

export async function setCredential(providerId: string, apiKey: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Hệ điều hành chưa sẵn sàng để lưu bí mật an toàn. Không lưu khoá dưới dạng văn bản thường.'
    )
  }

  const data = await readCredentialFile()
  const trimmed = apiKey.trim()

  if (trimmed.length === 0) {
    delete data[providerId]
  } else {
    data[providerId] = safeStorage.encryptString(trimmed).toString('base64')
  }

  await writeCredentialFile(data)
}

export async function deleteCredential(providerId: string): Promise<void> {
  const data = await readCredentialFile()
  delete data[providerId]
  await writeCredentialFile(data)
}

/**
 * Giải mã khoá để gọi provider. CHỈ dùng trong tiến trình main.
 * Trả về null khi chưa có khoá, để nơi gọi báo lỗi "thiếu khoá" cho đúng.
 */
export async function getCredential(providerId: string): Promise<string | null> {
  const data = await readCredentialFile()
  const encrypted = data[providerId]
  if (!encrypted) return null

  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch {
    // Giải mã hỏng khi hồ sơ người dùng đổi hoặc kho bí mật bị đặt lại.
    // Coi như chưa có khoá; người dùng sẽ nhập lại.
    return null
  }
}

/** Danh sách provider ĐÃ có khoá. Chỉ trả id, không bao giờ trả giá trị khoá. */
export async function listConfiguredProviders(): Promise<string[]> {
  const data = await readCredentialFile()
  return Object.keys(data)
}

export async function hasCredential(providerId: string): Promise<boolean> {
  const data = await readCredentialFile()
  return Boolean(data[providerId])
}
