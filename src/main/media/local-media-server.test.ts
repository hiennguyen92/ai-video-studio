import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  localMediaUrl,
  mediaServerOrigin,
  registerMediaFiles,
  startLocalMediaServer,
  stopLocalMediaServer
} from './local-media-server'

/**
 * Máy chủ media cục bộ.
 *
 * Hai thứ phải đúng, và cả hai đều hỏng âm thầm nếu sai:
 *
 *   - **Range request**: thiếu thì thẻ video phải tải trọn file mới phát, tua đứng hình.
 *   - **Không tra đường dẫn từ URL**: chỉ phục vụ asset đã đăng ký, nếu không thì
 *     một cổng loopback vừa mở ra là đọc được cả ổ đĩa.
 *   - **Header CORS**: thiếu thì canvas của lớp chuyển cảnh WebGL bị coi là
 *     "nhiễm" và không lên texture được — bản xem trước vẫn chạy, chỉ bản xuất
 *     lặng lẽ mất hiệu ứng.
 */

let workDir: string
let filePath: string
const CONTENT = Buffer.from('0123456789abcdefghijklmnopqrstuvwxyz')

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'media-server-'))
  filePath = join(workDir, 'canh-quay.mp4')
  await writeFile(filePath, CONTENT)

  await startLocalMediaServer()
  registerMediaFiles([{ id: 'asset_1', path: filePath }])
})

afterAll(async () => {
  await stopLocalMediaServer()
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('phục vụ media', () => {
  it('trả đủ nội dung và báo có hỗ trợ Range', async () => {
    const response = await fetch(localMediaUrl('asset_1') as string)

    expect(response.status).toBe(200)
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(CONTENT)
  })

  it('trả đúng lát cắt khi có Range — đây là thứ cho phép tua video', async () => {
    const response = await fetch(localMediaUrl('asset_1') as string, {
      headers: { Range: 'bytes=10-19' }
    })

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(`bytes 10-19/${CONTENT.length}`)
    expect(await response.text()).toBe('abcdefghij')
  })

  it('Range không nêu điểm cuối thì chạy tới hết file', async () => {
    const response = await fetch(localMediaUrl('asset_1') as string, {
      headers: { Range: 'bytes=30-' }
    })

    expect(response.status).toBe(206)
    expect(await response.text()).toBe('uvwxyz')
  })

  it('bỏ qua Range vô lý thay vì trả nội dung sai', async () => {
    for (const range of ['bytes=999-1000', 'bytes=20-10', 'chunks=0-5']) {
      const response = await fetch(localMediaUrl('asset_1') as string, {
        headers: { Range: range }
      })
      // Không hiểu thì trả nguyên file, không được cắt bừa.
      expect(response.status).toBe(200)
    }
  })
})

describe('ranh giới bảo mật', () => {
  it('từ chối khi thiếu token', async () => {
    const response = await fetch(`${mediaServerOrigin()}/media/asset_1`)
    expect(response.status).toBe(401)
  })

  it('từ chối token sai', async () => {
    const response = await fetch(`${mediaServerOrigin()}/media/asset_1?token=sai`)
    expect(response.status).toBe(401)
  })

  it('KHÔNG phục vụ asset chưa đăng ký', async () => {
    const url = (localMediaUrl('asset_1') as string).replace('asset_1', 'asset_la')
    const response = await fetch(url)
    expect(response.status).toBe(404)
  })

  it('không đọc được file tuỳ ý qua đường dẫn trong URL', async () => {
    // Kể cả khi đoán đúng token: URL mang đường dẫn thì cũng chỉ là một id lạ.
    const url = (localMediaUrl('asset_1') as string).replace(
      'asset_1',
      encodeURIComponent('/etc/passwd')
    )
    const response = await fetch(url)
    expect(response.status).toBe(404)
  })

  it('không leo thư mục được bằng ../', async () => {
    const url = (localMediaUrl('asset_1') as string).replace(
      'asset_1',
      encodeURIComponent('../../../../etc/hosts')
    )
    const response = await fetch(url)
    expect(response.status).toBe(404)
  })
})

describe('vòng đời', () => {
  it('chưa chạy máy chủ thì không sinh URL giả', async () => {
    await stopLocalMediaServer()
    expect(localMediaUrl('asset_1')).toBeNull()
    expect(mediaServerOrigin()).toBeNull()

    // Khởi động lại để các nhóm test khác (nếu chạy sau) vẫn dùng được.
    await startLocalMediaServer()
    registerMediaFiles([{ id: 'asset_1', path: filePath }])
  })
})

describe('header CORS', () => {
  it('cho phép đọc chéo nguồn, và lộ ra các header của Range', () => {
    // Trang dựng hình và server này nằm ở hai CỔNG khác nhau, tức hai nguồn khác
    // nhau. Không có dòng này thì `texImage2D` ném lỗi bảo mật.
    const url = localMediaUrl('asset_1')
    expect(url).toBeTruthy()
    return fetch(url as string).then(async (response) => {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(response.headers.get('access-control-expose-headers')).toContain('Content-Range')
      await response.arrayBuffer()
    })
  })

  it('trả lời preflight mà không cần token', async () => {
    const response = await fetch(`${mediaServerOrigin()}/media/asset_1`, { method: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })
})
