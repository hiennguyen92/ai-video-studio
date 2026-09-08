import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  TRUSTED_CLIENT_TOKEN,
  buildConfigMessage,
  buildSocketUrl,
  buildSsml,
  buildSsmlMessage,
  edgeTimestamp,
  escapeSsmlText,
  parseBinaryMessage,
  secMsGecToken,
  textMessagePath
} from './edge-tts-protocol'

/**
 * Giao thức Edge TTS, phần không đụng mạng.
 *
 * Ba chỗ dưới đây từng làm cả luồng hỏng IM LẶNG khi dựng adapter — kết nối mở
 * bình thường, không có lỗi nào, chỉ là không có byte audio nào về. Nên chúng
 * được khoá lại bằng test chứ không dựa vào việc nhớ:
 *
 *   1. dấu thời gian phải theo kiểu chuỗi Date của JavaScript
 *   2. hai byte đầu bản tin nhị phân là độ dài HEADER, không phải cả gói
 *   3. token băm theo mốc thời gian làm tròn xuống bội 5 phút
 */

describe('edgeTimestamp', () => {
  it('theo kiểu chuỗi Date của JavaScript, không phải RFC 1123', () => {
    const stamp = edgeTimestamp(new Date(Date.UTC(2026, 8, 8, 13, 45, 5)))

    expect(stamp).toBe('Tue Sep 08 2026 13:45:05 GMT+0000 (Coordinated Universal Time)')
    // toUTCString() có dấu phẩy sau thứ; gửi bản đó thì không nhận được audio.
    expect(stamp).not.toContain(',')
  })

  it('đệm số 0 cho ngày, giờ, phút và giây', () => {
    expect(edgeTimestamp(new Date(Date.UTC(2026, 0, 3, 4, 5, 6)))).toBe(
      'Sat Jan 03 2026 04:05:06 GMT+0000 (Coordinated Universal Time)'
    )
  })
})

describe('secMsGecToken', () => {
  it('băm mốc thời gian đã làm tròn xuống bội 5 phút', () => {
    const nowMs = Date.UTC(2026, 8, 8, 13, 47, 32)

    // Tính lại độc lập theo đúng mô tả, thay vì chép cứng một chuỗi băm.
    let ticks = nowMs / 1000 + 11_644_473_600
    ticks -= ticks % 300
    ticks *= 1e9 / 100
    const expected = createHash('sha256')
      .update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
      .digest('hex')
      .toUpperCase()

    expect(secMsGecToken(nowMs)).toBe(expected)
  })

  it('mọi thời điểm trong cùng một khung 5 phút cho cùng một token', () => {
    const base = Date.UTC(2026, 8, 8, 13, 45, 0)

    expect(secMsGecToken(base)).toBe(secMsGecToken(base + 299_000))
    expect(secMsGecToken(base)).not.toBe(secMsGecToken(base + 300_000))
  })

  it('ra 64 ký tự hex viết hoa', () => {
    expect(secMsGecToken(Date.UTC(2026, 8, 8))).toMatch(/^[0-9A-F]{64}$/)
  })
})

describe('buildSocketUrl', () => {
  it('mang đủ ConnectionId, token và phiên bản token', () => {
    const url = new URL(buildSocketUrl(Date.UTC(2026, 8, 8)))

    expect(url.searchParams.get('TrustedClientToken')).toBe(TRUSTED_CLIENT_TOKEN)
    expect(url.searchParams.get('ConnectionId')).toMatch(/^[0-9a-f]{32}$/)
    expect(url.searchParams.get('Sec-MS-GEC')).toMatch(/^[0-9A-F]{64}$/)
    expect(url.searchParams.get('Sec-MS-GEC-Version')).toMatch(/^1-\d+\./)
  })

  it('mỗi phiên một ConnectionId khác nhau', () => {
    const first = new URL(buildSocketUrl()).searchParams.get('ConnectionId')
    const second = new URL(buildSocketUrl()).searchParams.get('ConnectionId')

    expect(first).not.toBe(second)
  })
})

describe('escapeSsmlText', () => {
  it('thoát ký tự làm vỡ XML', () => {
    expect(escapeSsmlText('Giá <50k & rẻ > mong đợi')).toBe('Giá &lt;50k &amp; rẻ &gt; mong đợi')
  })

  it('giữ nguyên dấu tiếng Việt', () => {
    expect(escapeSsmlText('Quạt gấp gọn, mát rượi')).toBe('Quạt gấp gọn, mát rượi')
  })

  it('thay ký tự điều khiển bằng khoảng trắng, không xoá mất chữ', () => {
    // U+0007 lọt vào SSML thì máy chủ đóng kết nối mà không nói vì sao.
    expect(escapeSsmlText('a\u0007b')).toBe('a b')
    // Xuống dòng và tab KHÔNG phải ký tự phá SSML nên được giữ lại.
    expect(escapeSsmlText('a\nb\tc')).toBe('a\nb\tc')
  })
})

describe('buildSsml', () => {
  it('gói giọng và prosody đúng thứ tự thẻ', () => {
    const ssml = buildSsml('vi-VN-HoaiMyNeural', 'Xin chào', {
      rate: '+10%',
      pitch: '+0Hz',
      volume: '+0%'
    })

    expect(ssml).toContain("<voice name='vi-VN-HoaiMyNeural'>")
    expect(ssml).toContain("<prosody pitch='+0Hz' rate='+10%' volume='+0%'>")
    expect(ssml.endsWith('</prosody></voice></speak>')).toBe(true)
  })

  it('văn bản đi qua bộ thoát trước khi vào SSML', () => {
    expect(buildSsml('v', 'a & b', { rate: '+0%', pitch: '+0Hz', volume: '+0%' })).toContain(
      'a &amp; b'
    )
  })
})

describe('bản tin gửi đi', () => {
  it('bản tin cấu hình mang đúng định dạng đầu ra được yêu cầu', () => {
    const message = buildConfigMessage('audio-24khz-96kbitrate-mono-mp3', 'STAMP')

    expect(message).toContain('Path:speech.config')
    expect(message).toContain('"outputFormat":"audio-24khz-96kbitrate-mono-mp3"')
    expect(message).toContain('X-Timestamp:STAMP\r\n')
  })

  it('bản tin SSML giữ dấu Z thừa sau dấu thời gian', () => {
    const message = buildSsmlMessage('<speak/>', 'STAMP')

    // Chữ Z này là lỗi của chính client Edge. Bỏ đi thì máy chủ không trả audio.
    expect(message).toContain('X-Timestamp:STAMPZ\r\n')
    expect(message).toContain('Path:ssml\r\n\r\n<speak/>')
  })
})

describe('parseBinaryMessage', () => {
  /** Dựng đúng khung mà máy chủ gửi: 2 byte độ dài header, header, rồi audio. */
  function frame(header: string, payload: Buffer): Buffer {
    const head = Buffer.from(header, 'utf8')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(head.length, 0)
    return Buffer.concat([length, head, payload])
  }

  it('tách được đường dẫn, kiểu nội dung và phần audio', () => {
    const audio = Buffer.from([1, 2, 3, 4])
    const message = parseBinaryMessage(
      frame('Content-Type:audio/mpeg\r\nX-RequestId:abc\r\nPath:audio\r\n\r\n', audio)
    )

    expect(message.path).toBe('audio')
    expect(message.contentType).toBe('audio/mpeg')
    // Đây là chỗ dễ sai nhất: lấy nhầm sang header thì file mp3 dính rác ở đầu.
    expect([...message.payload]).toEqual([1, 2, 3, 4])
  })

  it('không ngã khi gói quá ngắn hoặc độ dài header vô lý', () => {
    expect(parseBinaryMessage(Buffer.from([0])).payload.length).toBe(0)

    const lying = Buffer.alloc(6)
    lying.writeUInt16BE(9_000, 0)
    expect(parseBinaryMessage(lying).payload.length).toBe(0)
  })
})

describe('textMessagePath', () => {
  it('đọc được mốc kết thúc lượt đọc', () => {
    expect(textMessagePath('X-RequestId:abc\r\nPath:turn.end\r\n\r\n')).toBe('turn.end')
  })

  it('không có Path thì trả về undefined', () => {
    expect(textMessagePath('chuỗi bất kỳ')).toBeUndefined()
  })
})
