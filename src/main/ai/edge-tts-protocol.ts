import { createHash, randomUUID } from 'node:crypto'

/**
 * Giao thức Edge TTS — phần thuần tuý, không đụng mạng.
 *
 * Dịch vụ đọc văn bản của Microsoft Edge không có tài liệu công khai, nên MỌI
 * hằng số và định dạng dưới đây đều được xác minh bằng cách gọi thật rồi đo,
 * không lấy theo trí nhớ (DESCRIPTION §6). Ghi lại số đo ngay tại chỗ vì lần sau
 * không ai còn nhớ vì sao lại là con số đó:
 *
 *   - danh sách giọng trả về 322 giọng, trong đó ĐÚNG 2 giọng tiếng Việt
 *   - bỏ header `User-Agent` → máy chủ trả 403 ngay ở bước bắt tay
 *   - `Origin` một mình KHÔNG đủ; chỉ `User-Agent` là bắt buộc
 *   - `X-Timestamp` phải theo kiểu chuỗi Date của JavaScript. Dùng RFC 1123
 *     (`toUTCString()`) thì kết nối vẫn mở nhưng không trả byte audio nào
 *   - `audio-48khz-192kbitrate-mono-mp3` và `riff-24khz-16bit-mono-pcm` luôn ra
 *     0 byte, nên chúng KHÔNG có trong danh sách định dạng
 */

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud'

export const EDGE_TTS_WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
export const EDGE_TTS_VOICES_URL = `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`

/** Phiên bản Edge mà máy chủ chấp nhận, đi cùng token chống lạm dụng. */
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0]

export const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`

/**
 * Header bắt buộc cho lần bắt tay WebSocket.
 *
 * Đo thật: thiếu `User-Agent` thì 403. Gửi kèm `Origin` mà thiếu `User-Agent`
 * cũng 403, nên `User-Agent` mới là thứ máy chủ kiểm.
 */
export const EDGE_TTS_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)' +
    ` Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
  'Accept-Language': 'en-US,en;q=0.9',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache'
}

/** Khoảng thời gian epoch Windows (1601-01-01) so với epoch Unix, tính bằng giây. */
const WINDOWS_EPOCH_OFFSET_SECONDS = 11_644_473_600

/**
 * Token chống lạm dụng `Sec-MS-GEC`.
 *
 * Băm SHA-256 của "thời điểm hiện tại làm tròn xuống bội 5 phút, tính theo đơn vị
 * 100 nano giây kiểu Windows" nối với token khách hàng. Làm tròn 5 phút nghĩa là
 * đồng hồ máy lệch quá 5 phút thì token sai và máy chủ từ chối.
 */
export function secMsGecToken(nowMs: number = Date.now()): string {
  let ticks = nowMs / 1000 + WINDOWS_EPOCH_OFFSET_SECONDS
  ticks -= ticks % 300
  ticks *= 1e9 / 100

  return createHash('sha256')
    .update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase()
}

/** Id kết nối: UUID bỏ hết dấu gạch nối. */
export function connectionId(): string {
  return randomUUID().replaceAll('-', '')
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Dấu thời gian theo ĐÚNG kiểu chuỗi Date của JavaScript.
 *
 * "Mon Sep 08 2026 13:45:00 GMT+0000 (Coordinated Universal Time)".
 *
 * Không dùng `toUTCString()`: nó cho ra RFC 1123 ("Mon, 08 Sep 2026 …"), và khi
 * gửi định dạng đó thì kết nối vẫn mở, vẫn nhận `turn.start`, nhưng KHÔNG bao giờ
 * có byte audio — một kiểu hỏng im lặng rất khó lần ra.
 */
export function edgeTimestamp(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')

  return (
    `${DAYS[date.getUTCDay()]} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCDate())} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  )
}

/** Địa chỉ WebSocket đầy đủ cho một phiên. */
export function buildSocketUrl(nowMs?: number): string {
  return (
    `${EDGE_TTS_WSS_URL}&ConnectionId=${connectionId()}` +
    `&Sec-MS-GEC=${secMsGecToken(nowMs)}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`
  )
}

/**
 * Loại bỏ ký tự điều khiển và thoát ký tự XML.
 *
 * Ký tự điều khiển làm hỏng SSML mà máy chủ không báo lỗi rõ ràng — nó chỉ đóng
 * kết nối. Thay bằng khoảng trắng như chính client của Edge làm.
 */
export function escapeSsmlText(text: string): string {
  const cleaned = [...text]
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      const isControl =
        (code >= 0 && code <= 8) || (code >= 11 && code <= 12) || (code >= 14 && code <= 31)
      return isControl ? ' ' : char
    })
    .join('')

  return cleaned.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export interface EdgeProsody {
  /** Ví dụ "+0%", "-15%". */
  rate: string
  /** Ví dụ "+0Hz", "-20Hz". */
  pitch: string
  /** Ví dụ "+0%", "-30%". */
  volume: string
}

export function buildSsml(voice: string, text: string, prosody: EdgeProsody): string {
  return (
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    `<prosody pitch='${prosody.pitch}' rate='${prosody.rate}' volume='${prosody.volume}'>` +
    escapeSsmlText(text) +
    '</prosody></voice></speak>'
  )
}

/** Bản tin cấu hình gửi ngay sau khi mở kết nối. */
export function buildConfigMessage(outputFormat: string, timestamp = edgeTimestamp()): string {
  return (
    `X-Timestamp:${timestamp}\r\n` +
    'Content-Type:application/json; charset=utf-8\r\n' +
    'Path:speech.config\r\n\r\n' +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    `"outputFormat":"${outputFormat}"}}}}\r\n`
  )
}

/** Bản tin SSML. Dấu "Z" thừa sau timestamp là lỗi của chính Edge, phải giữ nguyên. */
export function buildSsmlMessage(ssml: string, timestamp = edgeTimestamp()): string {
  return (
    `X-RequestId:${connectionId()}\r\n` +
    'Content-Type:application/ssml+xml\r\n' +
    `X-Timestamp:${timestamp}Z\r\n` +
    'Path:ssml\r\n\r\n' +
    ssml
  )
}

export interface EdgeBinaryMessage {
  path?: string
  contentType?: string
  payload: Buffer
}

/**
 * Tách bản tin nhị phân: hai byte đầu là ĐỘ DÀI PHẦN HEADER, không phải độ dài
 * cả gói. Đọc nhầm chỗ này thì audio dính vài chục byte header ở đầu và file mp3
 * vẫn phát được nhưng có tiếng lẹt xẹt lúc mở đầu.
 */
export function parseBinaryMessage(data: Buffer): EdgeBinaryMessage {
  if (data.length < 2) return { payload: Buffer.alloc(0) }

  const headerLength = data.readUInt16BE(0)
  if (headerLength + 2 > data.length) return { payload: Buffer.alloc(0) }

  const header = data.subarray(2, 2 + headerLength).toString('utf8')
  return {
    path: /Path:([^\r\n]+)/.exec(header)?.[1],
    contentType: /Content-Type:([^\r\n]+)/.exec(header)?.[1],
    payload: data.subarray(2 + headerLength)
  }
}

/** Đọc trường Path của một bản tin dạng chữ. */
export function textMessagePath(message: string): string | undefined {
  return /Path:([^\r\n]+)/.exec(message)?.[1]
}
