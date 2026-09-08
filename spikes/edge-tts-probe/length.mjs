// Giới hạn độ dài THẬT của một lần gọi, để đặt maxCharactersPerRequest theo số đo
// chứ không theo phỏng đoán.
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const WebSocket = require('ws')

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}`
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pad = (v) => String(v).padStart(2, '0')
function gec() { let t = Date.now()/1000 + 11644473600; t -= t % 300; t *= 1e9/100
  return createHash('sha256').update(`${t.toFixed(0)}${TOKEN}`,'ascii').digest('hex').toUpperCase() }
const cid = () => randomUUID().replaceAll('-','')
function stamp(){const n=new Date();return `${DAYS[n.getUTCDay()]} ${MONTHS[n.getUTCMonth()]} ${pad(n.getUTCDate())} ${n.getUTCFullYear()} ${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`}
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0' }

function synth(text) {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${WSS}&ConnectionId=${cid()}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-143.0.3650.75`, { headers: HEADERS })
    const chunks = []
    const done = (extra) => { try { socket.close() } catch {} ; resolve({ bytes: Buffer.concat(chunks).length, ...extra }) }
    socket.on('open', () => {
      socket.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`)
      socket.send(`X-RequestId:${cid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='vi-VN-HoaiMyNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${text}</prosody></voice></speak>`)
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) { const n = data.readUInt16BE(0)
        if (data.subarray(2, 2+n).toString('utf8').includes('Path:audio')) chunks.push(data.subarray(2+n)); return }
      if (data.toString('utf8').includes('Path:turn.end')) done({})
    })
    socket.on('error', (e) => done({ error: String(e).slice(0,70) }))
    socket.on('close', (code) => done({ close: code }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const UNIT = 'Quạt cầm tay gấp gọn rất tiện lợi cho mùa hè oi bức. '

for (const chars of [500, 1500, 2500, 4000, 6000]) {
  const text = UNIT.repeat(Math.ceil(chars / UNIT.length)).slice(0, chars)
  let result
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await sleep(2500)
    result = await synth(text)
    if (result.bytes > 0) break
  }
  console.log(`${String(chars).padStart(5)} ký tự (${Buffer.byteLength(text)} byte) → bytes=${result.bytes} ${result.error ?? ''}`)
}
