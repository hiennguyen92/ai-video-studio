import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Lưu cấu hình KHÔNG bí mật của provider, ví dụ địa chỉ máy chủ tự host.
 *
 * Tách hẳn khỏi kho khoá API: cấu hình ở đây là văn bản thường, đọc được, sửa
 * tay được, và không có lý do gì phải qua keychain. Trộn chung sẽ khiến file
 * bí mật phình ra vì những thứ chẳng cần bảo vệ, và làm khó việc soi lỗi cấu hình.
 *
 * Cũng nằm ngoài file project: máy chủ local là chuyện của MÁY này, không phải
 * của dự án — mở cùng project trên máy khác thì địa chỉ đó vô nghĩa.
 */

const CONFIG_FILE = 'provider-config.json'

/** providerId -> { field -> value } */
type ConfigFile = Record<string, Record<string, string>>

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE)
}

async function readConfigFile(): Promise<ConfigFile> {
  try {
    const raw = await readFile(configPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as ConfigFile
  } catch {
    return {}
  }
}

async function writeConfigFile(data: ConfigFile): Promise<void> {
  const target = configPath()
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8')
  await rename(temporary, target)
}

export async function getProviderConfig(providerId: string): Promise<Record<string, string>> {
  const data = await readConfigFile()
  return data[providerId] ?? {}
}

export async function setProviderConfig(
  providerId: string,
  config: Record<string, string>
): Promise<void> {
  const data = await readConfigFile()
  // Bỏ ô để trống thay vì lưu chuỗi rỗng, để `??` ở nơi dùng lấy được mặc định.
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(config)) {
    const trimmed = value.trim()
    if (trimmed) cleaned[key] = trimmed
  }

  if (Object.keys(cleaned).length === 0) delete data[providerId]
  else data[providerId] = cleaned

  await writeConfigFile(data)
}

export async function getAllProviderConfigs(): Promise<ConfigFile> {
  return readConfigFile()
}

/**
 * Chuẩn hoá địa chỉ máy chủ do người dùng nhập.
 *
 * Người dùng hay dán kèm dấu gạch chéo cuối hoặc quên giao thức. Sửa ở đây một
 * lần thay vì để mỗi adapter tự đoán, và từ chối thẳng nếu không phải http/https
 * — nhầm giao thức sẽ báo lỗi mạng khó hiểu ở tận lớp fetch.
 */
export function normaliseBaseUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  if (!trimmed) return ''

  // Phân biệt "thiếu giao thức" với "sai giao thức". Gắn http:// vào trước mọi
  // chuỗi không bắt đầu bằng http sẽ biến "ftp://may-chu" thành
  // "http://ftp://may-chu" — một URL vô nghĩa nhưng vẫn parse được, nên lỗi chỉ
  // lộ ra ở tận lớp mạng dưới dạng thông báo khó hiểu.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      throw new Error(`Địa chỉ máy chủ phải dùng http hoặc https, nhận được "${input}".`)
    }
    return trimmed
  }

  return `http://${trimmed}`
}
