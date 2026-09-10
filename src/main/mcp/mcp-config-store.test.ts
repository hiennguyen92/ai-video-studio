import { describe, expect, it } from 'vitest'
import { app } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadMcpConfig, mcpConfig, setMcpRequireToken } from './mcp-config-store'

/**
 * Lựa chọn bắt buộc khoá phải SỐNG SÓT qua lần mở app sau — người dùng tắt nó vì
 * client của họ không gửi được header, và bắt tắt lại mỗi lần mở app là biến một
 * lựa chọn thành một phiền toái.
 *
 * Và nó phải HỎNG VỀ PHÍA ĐÓNG: file rác, thiếu trường, hay bị sửa bậy đều rơi về
 * BẬT. Một lựa chọn bảo mật không được phép tắt vì đọc file thất bại.
 */

const configPath = (): string => join(app.getPath('userData'), 'mcp-config.json')

describe('cấu hình máy chủ MCP', () => {
  it('mặc định là bắt buộc khoá', async () => {
    expect((await loadMcpConfig()).requireToken).toBe(true)
  })

  it('tắt rồi đọc lại từ đĩa vẫn là tắt', async () => {
    await setMcpRequireToken(false)
    expect((await loadMcpConfig()).requireToken).toBe(false)
    expect(mcpConfig().requireToken).toBe(false)
  })

  it('bật lại rồi đọc lại từ đĩa vẫn là bật', async () => {
    await setMcpRequireToken(true)
    expect((await loadMcpConfig()).requireToken).toBe(true)
  })

  it('file rác thì rơi về BẬT, không rơi về tắt', async () => {
    await setMcpRequireToken(false)
    await writeFile(configPath(), 'đây không phải json', 'utf8')

    expect((await loadMcpConfig()).requireToken).toBe(true)
  })

  it('file thiếu trường cũng rơi về BẬT', async () => {
    await writeFile(configPath(), JSON.stringify({ somethingElse: 1 }), 'utf8')

    expect((await loadMcpConfig()).requireToken).toBe(true)
  })

  it('chỉ đúng false mới tắt, giá trị lạ không tắt được', async () => {
    // Ai đó sửa tay thành `"false"` hay `0` thì đó là file hỏng, không phải ý
    // định tắt — và đoán bừa theo hướng tắt là mở cửa ngoài ý muốn.
    await writeFile(configPath(), JSON.stringify({ requireToken: 'false' }), 'utf8')

    expect((await loadMcpConfig()).requireToken).toBe(true)
  })
})
