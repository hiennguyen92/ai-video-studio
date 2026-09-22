import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { extname } from 'node:path'

/**
 * Máy chủ HTTP cục bộ phục vụ media cho Remotion.
 *
 * Vì sao cần, dù đã có scheme `avstudio-media://`: bộ dựng khung hình của Remotion
 * là **tiến trình riêng**, không phải Chromium của Electron, nên nó không biết
 * scheme tự đăng ký. Nó chỉ nạp được `http://` hoặc file nằm trong `publicDir` —
 * mà media của người dùng thì nằm rải rác khắp ổ đĩa.
 *
 * Bảo mật: máy chủ **không nhận đường dẫn** từ URL. Nó chỉ phục vụ những asset đã
 * được renderer đăng ký trước, tra theo id. Nhờ vậy không có đường nào đọc lung
 * tung ổ đĩa kể cả khi ai đó đoán được cổng. Kèm token vì cổng loopback thì mọi
 * tiến trình trên máy đều gọi được.
 *
 * Token nằm ở query chứ không ở header: thẻ `<video>` và bộ nạp của Remotion đều
 * không đặt được header khi tải media.
 */

const DEFAULT_PORT = 5210
const PORT_ATTEMPTS = 10

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/** id asset -> đường dẫn tuyệt đối. Chỉ những gì có ở đây mới phục vụ được. */
const registry = new Map<string, string>()

let httpServer: Server | null = null
let serverToken = ''
let serverPort = 0

export function registerMediaFiles(entries: Array<{ id: string; path: string }>): void {
  for (const entry of entries) {
    if (entry.id && entry.path) registry.set(entry.id, entry.path)
  }
}

export function mediaServerOrigin(): string | null {
  return httpServer ? `http://127.0.0.1:${serverPort}` : null
}

/** URL để đưa vào composition. Chưa chạy máy chủ thì không có gì phát được. */
export function localMediaUrl(assetId: string): string | null {
  const origin = mediaServerOrigin()
  if (!origin) return null
  return `${origin}/media/${encodeURIComponent(assetId)}?token=${serverToken}`
}

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Đọc header Range.
 *
 * Không có phần này thì thẻ `<video>` phải tải trọn file mới phát được, và tua
 * thì đứng hình — đúng lý do scheme sẵn có phải bật `stream: true`.
 */
function parseRange(
  header: string | undefined,
  size: number
): { start: number; end: number } | null {
  if (!header?.startsWith('bytes=')) return null

  const [rawStart, rawEnd] = header.slice(6).split('-')
  const start = rawStart ? Number(rawStart) : 0
  const end = rawEnd ? Number(rawEnd) : size - 1

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end >= size || start > end) return null
  return { start, end }
}

/**
 * Cho phép đọc chéo nguồn.
 *
 * Lớp chuyển cảnh WebGL vẽ khung hình của media vào canvas rồi đưa lên texture.
 * Trang dựng hình và server media này nằm ở hai CỔNG khác nhau, tức hai nguồn khác
 * nhau, nên nếu không có dòng này thì canvas bị coi là "nhiễm" và `texImage2D`
 * ném lỗi bảo mật — chuyển cảnh WebGL im lặng lùi về bản CSS ở bản xuất, còn bản
 * xem trước thì vẫn chạy, đúng kiểu lệch nhau khó tìm nhất.
 *
 * Mở cho mọi nguồn là chấp nhận được vì cửa đã khoá bằng chỗ khác: server chỉ nghe
 * trên loopback, mỗi yêu cầu phải mang token ngẫu nhiên của phiên, và id media
 * phải có trong sổ đăng ký. Không có token thì mở hay không cũng không đọc được gì.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')

  if (request.method === 'OPTIONS') {
    response.writeHead(204, { ...CORS_HEADERS, 'Access-Control-Allow-Methods': 'GET, OPTIONS' })
    response.end()
    return
  }

  if (url.searchParams.get('token') !== serverToken) {
    response.writeHead(401).end('Unauthorized')
    return
  }

  const match = /^\/media\/(.+)$/.exec(url.pathname)
  if (!match) {
    response.writeHead(404).end('Not found')
    return
  }

  const path = registry.get(decodeURIComponent(match[1]))
  if (!path) {
    // Id không có trong sổ đăng ký — không tra đường dẫn từ URL, không đoán.
    response.writeHead(404).end('Media chưa được đăng ký')
    return
  }

  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    response.writeHead(404).end('Không đọc được file media')
    return
  }

  const contentType = contentTypeFor(path)
  const range = parseRange(request.headers.range, size)

  if (range) {
    response.writeHead(206, {
      ...CORS_HEADERS,
      'Content-Type': contentType,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes'
    })
    createReadStream(path, { start: range.start, end: range.end }).pipe(response)
    return
  }

  response.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': contentType,
    'Content-Length': size,
    // Báo có hỗ trợ Range để trình phát biết là tua được.
    'Accept-Ranges': 'bytes'
  })
  createReadStream(path).pipe(response)
}

export async function startLocalMediaServer(): Promise<string | null> {
  if (httpServer) return mediaServerOrigin()

  serverToken = randomBytes(16).toString('hex')

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const port = DEFAULT_PORT + attempt
    const server = createServer((request, response) => {
      void handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(500)
        response.end('Lỗi máy chủ media')
      })
    })

    const listening = await new Promise<boolean>((resolve) => {
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })

    if (listening) {
      httpServer = server
      serverPort = port
      return mediaServerOrigin()
    }
    server.close()
  }

  return null
}

export async function stopLocalMediaServer(): Promise<void> {
  registry.clear()
  if (!httpServer) return
  const server = httpServer
  httpServer = null
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
