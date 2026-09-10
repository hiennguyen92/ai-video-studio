import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setMcpTokenRequired, startMcpServer, stopMcpServer } from './mcp-server'

/**
 * Chốt kiểm khoá của máy chủ MCP.
 *
 * Đây là phép thử BẢO MẬT, không phải phép thử tính năng: nó phải chứng minh
 * rằng tắt khoá thì mở cửa THẬT, và bật lại thì đóng cửa THẬT. Kiểm bằng cách gọi
 * HTTP tới cổng đang chạy, không kiểm bằng cách đọc biến trạng thái — một chốt
 * kiểm "đúng theo biến" nhưng sai ở đường xử lý yêu cầu là thứ không ai thấy.
 *
 * Chỉ soi mã 401. Yêu cầu đi qua được chốt sẽ ngã ở tầng giao thức MCP vì thân
 * yêu cầu không hợp lệ — đó là chuyện khác và không phải việc của phép thử này.
 */

let url = ''
let token = ''

const goi = async (headers: Record<string, string> = {}): Promise<number> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}'
  })
  return response.status
}

beforeAll(async () => {
  const status = await startMcpServer()
  if (!status.running || !status.url || !status.token) {
    throw new Error(status.error ?? 'không dựng được máy chủ MCP')
  }
  url = status.url
  token = status.token
})

afterAll(async () => {
  await setMcpTokenRequired(true)
  await stopMcpServer()
})

describe('chốt kiểm khoá của máy chủ MCP', () => {
  it('mặc định là BẬT, và chặn yêu cầu không có khoá', async () => {
    expect(await goi()).toBe(401)
  })

  it('nhận khoá đúng ở cả hai kiểu header', async () => {
    expect(await goi({ 'x-avs-token': token })).not.toBe(401)
    expect(await goi({ authorization: `Bearer ${token}` })).not.toBe(401)
  })

  it('chặn khoá sai', async () => {
    expect(await goi({ 'x-avs-token': 'sai-bet' })).toBe(401)
  })

  it('tắt đi thì cho qua thật, không chỉ đổi biến trạng thái', async () => {
    const status = await setMcpTokenRequired(false)
    expect(status.requireToken).toBe(false)

    expect(await goi()).not.toBe(401)
  })

  it('bật lại thì đóng ngay, và vẫn nhận đúng khoá cũ', async () => {
    await setMcpTokenRequired(false)
    await setMcpTokenRequired(true)

    expect(await goi()).toBe(401)
    // Khoá không đổi khi bật tắt, nên client đang nối không phải cấu hình lại.
    expect(await goi({ 'x-avs-token': token })).not.toBe(401)
  })
})
