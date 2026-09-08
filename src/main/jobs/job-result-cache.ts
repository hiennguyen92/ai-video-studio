import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { projectPaths } from '../storage/workspace-paths'

/**
 * Nhớ lại kết quả đã sinh, tra theo vân tay yêu cầu.
 *
 * Giải quyết đúng hai câu trong DESCRIPTION §6: "Chống chèn trùng asset khi retry"
 * và "Lưu kết quả đã tạo để sử dụng lại".
 *
 * Sinh giọng đọc tốn tiền và tốn thời gian. Người dùng bấm Thử lại sau một lỗi
 * mạng, hoặc sinh lại đúng đoạn kịch bản cũ, thì không có lý do gì gọi provider
 * lần nữa — cũng không được tạo thêm một asset trùng nội dung trong thư viện.
 *
 * Cache nằm trong thư mục cache của TỪNG project, nên kết quả không bao giờ lẫn
 * sang project khác.
 */

const INDEX_FILE = 'job-results.json'

interface CacheEntry {
  fingerprint: string
  /** Đường dẫn tuyệt đối tới file kết quả. */
  path: string
  createdAt: string
  providerId: string
  model: string
}

type CacheIndex = Record<string, CacheEntry>

function indexPath(projectId: string): string {
  return join(projectPaths(projectId).cacheDir, INDEX_FILE)
}

/**
 * Vân tay yêu cầu: băm toàn bộ thứ ảnh hưởng tới kết quả.
 *
 * Khoá được sắp xếp trước khi băm, nếu không thì cùng một yêu cầu viết theo thứ
 * tự trường khác nhau sẽ ra vân tay khác nhau và cache không bao giờ trúng.
 */
export function computeRequestFingerprint(input: Record<string, unknown>): string {
  const normalise = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalise)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, normalise(inner)])
      )
    }
    return value
  }

  return createHash('sha256')
    .update(JSON.stringify(normalise(input)))
    .digest('hex')
}

/**
 * Tên file kết quả của một job.
 *
 * Phải lấy theo VÂN TAY, không lấy theo mốc thời gian. Bấm "Tạo audio" cho cả
 * kịch bản xếp hàng chín job trong vài mili giây; đặt tên bằng `Date.now()` thì
 * nhiều job trùng tên và ghi đè lên nhau — quan sát thật trên một kịch bản 9 câu:
 * 8 asset trỏ vào đúng 2 file, và timeline đọc sai câu mà không báo lỗi gì.
 *
 * Lấy theo vân tay còn giữ đúng hành vi dùng lại: cùng một yêu cầu ra cùng tên
 * file nên không sinh lại.
 */
export function resultBaseName(prefix: string, fingerprint: string): string {
  return `${prefix}-${fingerprint.slice(0, 16)}`
}

async function readIndex(projectId: string): Promise<CacheIndex> {
  try {
    const raw = await readFile(indexPath(projectId), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as CacheIndex
  } catch {
    return {}
  }
}

async function writeIndex(projectId: string, index: CacheIndex): Promise<void> {
  const target = indexPath(projectId)
  await mkdir(projectPaths(projectId).cacheDir, { recursive: true })
  // Tên file tạm phải DUY NHẤT cho từng lần ghi. Dùng chung một `.tmp` thì hai
  // job xong cùng lúc cùng ghi vào đó, cái đầu đổi tên xong, cái sau đổi tên một
  // file không còn tồn tại và ngã với ENOENT — job coi như thất bại dù audio đã
  // sinh xong.
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(index, null, 2), 'utf8')
  await rename(temporary, target)
}

/**
 * Hàng đợi ghi chỉ mục, MỘT hàng cho mỗi project.
 *
 * Chỉ đặt tên file tạm khác nhau là chưa đủ. Đọc–sửa–ghi chồng nhau vẫn mất dữ
 * liệu: hai job cùng đọc một bản chỉ mục, mỗi bên thêm mục của mình rồi ghi đè,
 * và mục của bên ghi trước biến mất. Hậu quả là kết quả đã sinh nhưng cache
 * không nhớ, nên lần sau sinh lại — tốn tiền với provider tính phí.
 */
const indexWriteQueues = new Map<string, Promise<unknown>>()

function serialiseIndexWrite<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = indexWriteQueues.get(projectId) ?? Promise.resolve()
  // Nuốt lỗi của lượt trước để một lần ghi hỏng không chặn cả hàng đợi.
  const next = previous.catch(() => undefined).then(task)
  indexWriteQueues.set(
    projectId,
    next.catch(() => undefined)
  )
  return next
}

/**
 * Tra kết quả đã có. Trả null khi chưa có HOẶC khi file kết quả đã bị xoá —
 * cache chỉ tính là trúng khi file thật sự còn nằm trên đĩa.
 */
export async function lookupCachedResult(
  projectId: string,
  fingerprint: string
): Promise<CacheEntry | null> {
  const index = await readIndex(projectId)
  const entry = index[fingerprint]
  if (!entry) return null

  try {
    await access(entry.path, constants.R_OK)
    return entry
  } catch {
    // Thư mục cache có thể bị xoá bất cứ lúc nào; dọn luôn mục chỉ tới file đã mất.
    await serialiseIndexWrite(projectId, async () => {
      const current = await readIndex(projectId)
      delete current[fingerprint]
      await writeIndex(projectId, current)
    })
    return null
  }
}

export async function rememberResult(
  projectId: string,
  entry: Omit<CacheEntry, 'createdAt'>
): Promise<void> {
  await serialiseIndexWrite(projectId, async () => {
    // Đọc LẠI bên trong hàng đợi: bản đọc ngoài hàng đợi có thể đã cũ.
    const index = await readIndex(projectId)
    index[entry.fingerprint] = { ...entry, createdAt: new Date().toISOString() }
    await writeIndex(projectId, index)
  })
}

/** Ghi file kết quả vào thư mục media của project rồi ghi nhớ vân tay. */
export async function storeResultFile(
  projectId: string,
  fileName: string,
  bytes: Uint8Array
): Promise<string> {
  const mediaDir = projectPaths(projectId).mediaDir
  await mkdir(mediaDir, { recursive: true })
  const target = join(mediaDir, fileName)
  await writeFile(target, bytes)
  return target
}
