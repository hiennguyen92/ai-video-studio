// Xác minh giao thức Edge TTS bằng cách CHẠY THẬT, không lấy theo trí nhớ.
// Trả lời hai câu: (1) luồng WebSocket có ra audio không, (2) những header phụ
// (Origin, User-Agent, Cookie) có bắt buộc không.
import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`
const CHROMIUM_FULL_VERSION = '143.0.3650.75'
const WIN_EPOCH = 11_644_473_600

function secMsGec() {
  let ticks = Date.now() / 1000 + WIN_EPOCH
  ticks -= ticks % 300
  ticks *= 1e9 / 100
  return createHash('sha256')
    .update(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex')
    .toUpperCase()
}

const connectId = () => randomUUID().replaceAll('-', '')
// Đúng kiểu chuỗi Date của JavaScript: "Mon Sep 08 2026 13:45:00 GMT+0000 (…)".
// toUTCString() cho ra RFC 1123 ("Mon, 08 Sep 2026 …") — khác hẳn, và dịch vụ
// nhận kết nối rồi đóng ngay mà không trả byte audio nào.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (value) => String(value).padStart(2, '0')
const dateString = () => {
  const now = new Date()
  return (
    `${DAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${pad(now.getUTCDate())} ` +
    `${now.getUTCFullYear()} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:` +
    `${pad(now.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  )
}

function run(label, headers) {
  return new Promise((resolve) => {
    const url = `${WSS_URL}&ConnectionId=${connectId()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM_FULL_VERSION}`
    const socket = new WebSocket(url, { headers })
    const chunks = []
    const started = Date.now()

    const finish = (result) => {
      try { socket.close() } catch {}
      resolve({ label, ...result, ms: Date.now() - started })
    }

    socket.on('open', () => {
      socket.send(
        `X-Timestamp:${dateString()}\r\n` +
          'Content-Type:application/json; charset=utf-8\r\n' +
          'Path:speech.config\r\n\r\n' +
          '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
      )
      const ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
        "<voice name='vi-VN-NamMinhNeural'>" +
        "<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" +
        'Quạt cầm tay gấp gọn, bé bằng bàn tay mà gió thổi bay cả tờ giấy.' +
        '</prosody></voice></speak>'
      socket.send(
        `X-RequestId:${connectId()}\r\n` +
          'Content-Type:application/ssml+xml\r\n' +
          `X-Timestamp:${dateString()}Z\r\n` +
          'Path:ssml\r\n\r\n' +
          ssml
      )
    })

    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const headerLength = data.readUInt16BE(0)
        const head = data.subarray(2, 2 + headerLength).toString('utf8')
        if (head.includes('Path:audio')) chunks.push(data.subarray(2 + headerLength))
        return
      }
      const text = data.toString('utf8')
      if (text.includes('Path:turn.end')) {
        finish({ ok: chunks.length > 0, bytes: Buffer.concat(chunks).length, audio: Buffer.concat(chunks) })
      }
    })

    socket.on('error', (error) => finish({ ok: false, error: String(error) }))
    socket.on('close', (code, reason) =>
      finish({ ok: chunks.length > 0, bytes: Buffer.concat(chunks).length, close: `${code} ${reason}`, audio: Buffer.concat(chunks) })
    )
  })
}

const FULL_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  'Accept-Language': 'en-US,en;q=0.9',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  Cookie: `muid=${randomUUID().replaceAll('-', '').toUpperCase()};`
}

const report = (r) =>
  console.log(
    `${r.label} → ok=${r.ok} bytes=${r.bytes ?? 0} ${r.ms}ms ${r.error ?? r.close ?? ''}`
  )

const withHeaders = await run('có header đầy đủ', FULL_HEADERS)
report(withHeaders)
if (withHeaders.audio?.length) writeFileSync(new URL('./voice.mp3', import.meta.url), withHeaders.audio)

report(await run('không header phụ', undefined))
report(await run('chỉ User-Agent', { 'User-Agent': FULL_HEADERS['User-Agent'] }))
report(await run('chỉ Origin', { Origin: FULL_HEADERS.Origin }))
