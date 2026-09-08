// Xác minh những định dạng đầu ra và tham số prosody nào THẬT SỰ chạy, để adapter
// chỉ bày ra thứ đã kiểm chứng (DESCRIPTION §3.B).
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}`
const WIN_EPOCH = 11_644_473_600
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (v) => String(v).padStart(2, '0')

function gec() {
  let t = Date.now() / 1000 + WIN_EPOCH
  t -= t % 300
  t *= 1e9 / 100
  return createHash('sha256').update(`${t.toFixed(0)}${TOKEN}`, 'ascii').digest('hex').toUpperCase()
}
const cid = () => randomUUID().replaceAll('-', '')
function stamp() {
  const n = new Date()
  return `${DAYS[n.getUTCDay()]} ${MONTHS[n.getUTCMonth()]} ${pad(n.getUTCDate())} ${n.getUTCFullYear()} ${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0'
}

function synth(format, prosody = { pitch: '+0Hz', rate: '+0%', volume: '+0%' }) {
  return new Promise((resolve) => {
    const socket = new WebSocket(
      `${WSS}&ConnectionId=${cid()}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-143.0.3650.75`,
      { headers: HEADERS }
    )
    const chunks = []
    let contentType = null
    const done = (extra) => {
      try { socket.close() } catch {}
      resolve({ format, bytes: Buffer.concat(chunks).length, contentType, ...extra })
    }
    socket.on('open', () => {
      socket.send(
        `X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"${format}"}}}}\r\n`
      )
      socket.send(
        `X-RequestId:${cid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n` +
          `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='vi-VN-HoaiMyNeural'><prosody pitch='${prosody.pitch}' rate='${prosody.rate}' volume='${prosody.volume}'>Xin chào, đây là bản thử tiếng Việt.</prosody></voice></speak>`
      )
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) {
        const head = data.subarray(2, 2 + data.readUInt16BE(0)).toString('utf8')
        const match = /Content-Type:([^\r\n]+)/.exec(head)
        if (match) contentType = match[1]
        if (head.includes('Path:audio')) chunks.push(data.subarray(2 + data.readUInt16BE(0)))
        return
      }
      if (data.toString('utf8').includes('Path:turn.end')) done({})
    })
    socket.on('error', (e) => done({ error: String(e).slice(0, 80) }))
    socket.on('close', (code) => done({ close: code }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Nghỉ giữa các lần gọi: chuỗi kết nối liên tiếp dễ bị chặn tần suất, và lúc đó
// mọi trường hợp đều ra 0 byte — trông y hệt "tham số bị từ chối".
const cases = [
  ['format', 'audio-48khz-192kbitrate-mono-mp3', {}],
  ['format', 'riff-24khz-16bit-mono-pcm', {}],
  ['prosody', 'audio-24khz-48kbitrate-mono-mp3', { pitch: '-20Hz', rate: '+0%', volume: '+0%' }],
  ['prosody', 'audio-24khz-48kbitrate-mono-mp3', { pitch: '+0Hz', rate: '+0%', volume: '-30%' }],
  ['đối chứng', 'audio-24khz-48kbitrate-mono-mp3', { pitch: '+0Hz', rate: '+0%', volume: '+0%' }]
]

for (const [kind, format, prosody] of cases) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await sleep(3000)
    const r = await synth(format, Object.keys(prosody).length ? prosody : undefined)
    console.log(
      `${kind.padEnd(9)} ${format.padEnd(32)} ${JSON.stringify(prosody)} lần ${attempt} → bytes=${r.bytes} ${r.error ?? ''}`
    )
    if (r.bytes > 0) break
  }
}
