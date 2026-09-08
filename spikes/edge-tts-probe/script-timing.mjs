// Đo độ dài đọc của từng câu trong kịch bản, để biết câu nào dài hơn cảnh của nó.
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const WebSocket = require('ws')
const execFileAsync = promisify(execFile)

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'
const WSS = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}`
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const pad = (v) => String(v).padStart(2, '0')
function gec(){let t=Date.now()/1000+11644473600;t-=t%300;t*=1e9/100
  return createHash('sha256').update(`${t.toFixed(0)}${TOKEN}`,'ascii').digest('hex').toUpperCase()}
const cid = () => randomUUID().replaceAll('-','')
function stamp(){const n=new Date();return `${DAYS[n.getUTCDay()]} ${MONTHS[n.getUTCMonth()]} ${pad(n.getUTCDate())} ${n.getUTCFullYear()} ${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`}
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0' }

function synth(text, rate = '+0%') {
  return new Promise((resolve) => {
    const socket = new WebSocket(`${WSS}&ConnectionId=${cid()}&Sec-MS-GEC=${gec()}&Sec-MS-GEC-Version=1-143.0.3650.75`, { headers: HEADERS })
    const chunks = []
    const done = () => { try { socket.close() } catch {} ; resolve(Buffer.concat(chunks)) }
    socket.on('open', () => {
      socket.send(`X-Timestamp:${stamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`)
      socket.send(`X-RequestId:${cid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${stamp()}Z\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='vi-VN-HoaiMyNeural'><prosody pitch='+0Hz' rate='${rate}' volume='+0%'>${text}</prosody></voice></speak>`)
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) { const n = data.readUInt16BE(0)
        if (data.subarray(2,2+n).toString('utf8').includes('Path:audio')) chunks.push(data.subarray(2+n)); return }
      if (data.toString('utf8').includes('Path:turn.end')) done()
    })
    socket.on('error', done)
    socket.on('close', done)
  })
}

const FFPROBE = process.env.FFPROBE
const LINES = [
  ['Bé bằng bàn tay mà thổi bay cả tờ giấy.', 3.0],
  ['Gấp lại nhỏ như cây bút, bỏ túi quần luôn.', 2.4],
  ['Mở ra hai giây là thành quạt.', 2.9],
  ['Gió mạnh mà chạy rất êm.', 2.4],
  ['Đủ mát cho cả mặt và cổ.', 2.2],
  ['Gập chân đế xuống là để bàn, rảnh cả hai tay.', 2.8],
  ['Kiêm luôn đèn ngủ ánh vàng dịu.', 2.9],
  ['Kiêm cả sạc dự phòng, cổng USB và Type C.', 2.8],
  ['Giỏ hàng màu cam ngay bên dưới nhé.', 2.8]
]

mkdirSync(new URL('./lines/', import.meta.url), { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let total = 0
for (const [index, [text, budget]] of LINES.entries()) {
  let audio = Buffer.alloc(0)
  for (let attempt = 1; attempt <= 3 && audio.length === 0; attempt += 1) {
    await sleep(700)
    audio = await synth(text, process.env.RATE ?? '+0%')
  }
  const file = new URL(`./lines/line-${index}.mp3`, import.meta.url)
  writeFileSync(file, audio)
  const { stdout } = await execFileAsync(FFPROBE, ['-v','error','-show_entries','format=duration','-of','csv=p=0', file.pathname])
  const seconds = Number(stdout.trim())
  total += seconds
  const over = seconds > budget ? `  DÀI HƠN CẢNH ${(seconds - budget).toFixed(2)}s` : ''
  console.log(`${index}: ${seconds.toFixed(2)}s / cảnh ${budget}s${over}  "${text}"`)
}
console.log(`tổng giọng đọc ${total.toFixed(2)}s, video 24.26s`)
