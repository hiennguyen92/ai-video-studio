import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { MEDIA_PROTOCOL_SCHEME } from '../../shared/ipc/ipc-contract'

/**
 * Scheme `avstudio-media://` để renderer phát media local.
 *
 * Vì sao không dùng thẳng `file://`: bật `file://` trong renderer đồng nghĩa với
 * hạ webSecurity, khiến mọi nội dung chạy trong cửa sổ đọc được cả ổ đĩa.
 * Scheme riêng cho phép giữ nguyên hàng rào bảo mật mà vẫn phát được video.
 *
 * `stream: true` là phần bắt buộc: thiếu nó, Chromium không gửi Range request và
 * thẻ <video> sẽ tải cả file rồi mới phát, tua thì đứng hình.
 */

export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ])
}

export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    let absolutePath: string
    try {
      const url = new URL(request.url)
      // URL dạng avstudio-media://local/<đường dẫn đã encode>
      absolutePath = decodeURIComponent(url.pathname.replace(/^\//, ''))
    } catch {
      return new Response('URL media không hợp lệ', { status: 400 })
    }

    if (!absolutePath) {
      return new Response('Thiếu đường dẫn media', { status: 400 })
    }

    try {
      // net.fetch chuyển tiếp header Range, nhờ đó tua video hoạt động.
      return await net.fetch(pathToFileURL(absolutePath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return new Response(`Không đọc được media: ${message}`, { status: 404 })
    }
  })
}
