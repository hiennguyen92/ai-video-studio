import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { _electron as electron } from 'playwright'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Đo preview: Remotion Player có tua và phát mượt không.
 *
 * Chạy trong ELECTRON thật, không phải Chromium rời — đây đúng là môi trường app
 * sẽ chạy, nên con số dùng để quyết định được.
 */

const execFileAsync = promisify(execFile)
const FPS = 30
const WIDTH = 1080
const HEIGHT = 1920

const seconds = (ms) => (ms / 1000).toFixed(1)

async function makeSourceFootage(publicDir) {
  await mkdir(publicDir, { recursive: true })
  const path = join(publicDir, 'nguon.mp4')
  await execFileAsync(String(ffmpegStatic), [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${WIDTH}x${HEIGHT}:rate=${FPS}:duration=40`,
    '-vf', 'noise=alls=12:allf=t+u',
    '-c:v', 'libx264', '-preset', 'medium', '-b:v', '12M', '-pix_fmt', 'yuv420p',
    path
  ])
  return path
}

const workDir = await mkdtemp(join(tmpdir(), 'player-bench-'))
const publicDir = join(workDir, 'public')
let server
let browser

try {
  console.log('Đang tạo footage nguồn…')
  await makeSourceFootage(publicDir)

  server = await createServer({
    root: import.meta.dirname,
    publicDir,
    plugins: [react()],
    server: { port: 0 },
    logLevel: 'error'
  })
  await server.listen()
  const port = server.config.server.port ?? server.httpServer.address().port
  const url = `http://localhost:${port}/`
  console.log(`Vite: ${url}`)

  browser = await electron.launch({
    args: [join(import.meta.dirname, 'electron-main.cjs')],
    env: { ...process.env, BENCH_URL: url }
  })
  const page = await browser.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.waitForLoadState('load')
  await page.waitForFunction(() => window.__benchReady === true, { timeout: 60_000 })
  // Cho Player nạp xong video trước khi đo, nếu không sẽ đo cả thời gian tải file.
  await page.waitForTimeout(3000)

  console.log('\nĐang đo phát…')
  const playback = await page.evaluate(async () => window.__measurePlayback(8000))

  // Kiểm chứng: đồng hồ chạy 30fps KHÔNG có nghĩa là hình có đổi. Chụp vài ảnh
  // trong lúc phát và so byte — khác nhau thì mới thật sự có vẽ.
  console.log('Đang kiểm chứng hình có đổi thật…')
  const frames = []
  await page.evaluate(() => document.querySelector('#root')?.scrollIntoView())
  const stage = page.locator('#root')
  await page.evaluate(async () => {
    const player = window.__player
    void player
  })
  await page.evaluate(() => window.__measurePlayback(0)).catch(() => undefined)

  const playing = page.evaluate(() => window.__measurePlayback(3000))
  for (let index = 0; index < 3; index += 1) {
    await page.waitForTimeout(700)
    frames.push(await stage.screenshot())
  }
  await playing

  const distinct = new Set(frames.map((buffer) => buffer.toString('base64'))).size
  console.log(`  ${distinct}/${frames.length} ảnh chụp khác nhau`)

  console.log('Đang đo tua…')
  // Tua khắp video, kể cả ngay giữa chuyển cảnh (chỗ phải giải mã hai luồng).
  const seekFrames = [0, 60, 150, 210, 300, 375, 450, 525, 600, 690]
  const seeks = await page.evaluate(
    async (frames) => window.__measureSeek(frames),
    seekFrames
  )

  // Đo độ trễ THẬT của thao tác tua: từ lúc bấm tới lúc HÌNH đổi, bao gồm cả giải
  // mã video. Con số trên chỉ là cập nhật trạng thái React, chưa phải thứ mắt thấy.
  console.log('Đang đo tua tới lúc hình đổi…')
  const paintSeeks = []
  for (const frame of [0, 300, 690, 150, 525]) {
    await page.evaluate((target) => window.__measureSeek([target]), frame === 0 ? 690 : 0)
    await page.waitForTimeout(250)
    const before = (await stage.screenshot()).toString('base64')

    const start = Date.now()
    await page.evaluate((target) => window.__measureSeek([target]), frame)

    let elapsed = null
    while (Date.now() - start < 3000) {
      if ((await stage.screenshot()).toString('base64') !== before) {
        elapsed = Date.now() - start
        break
      }
    }
    paintSeeks.push(elapsed ?? 3000)
  }
  const paintMedian = [...paintSeeks].sort((a, b) => a - b)[Math.floor(paintSeeks.length / 2)]

  // Cùng phương pháp, trên thẻ <video> trần — tách chi phí Remotion khỏi chi phí
  // giải mã video vốn có.
  console.log('Đang đo tua trên <video> trần…')
  const plain = page.locator('#plain')
  const plainSeeks = []
  for (const target of [1, 10, 23, 5, 17]) {
    await page.evaluate((value) => window.__seekPlainVideo(value), target === 1 ? 23 : 1)
    await page.waitForTimeout(250)
    const before = (await plain.screenshot()).toString('base64')

    const start = Date.now()
    await page.evaluate((value) => window.__seekPlainVideo(value), target)
    let elapsed = null
    while (Date.now() - start < 3000) {
      if ((await plain.screenshot()).toString('base64') !== before) {
        elapsed = Date.now() - start
        break
      }
    }
    plainSeeks.push(elapsed ?? 3000)
  }
  const plainMedian = [...plainSeeks].sort((a, b) => a - b)[Math.floor(plainSeeks.length / 2)]

  const sorted = [...seeks].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  const worst = sorted.at(-1)

  console.log('\n════════ KẾT QUẢ PREVIEW ════════')
  console.log(`Phát: ${playback.effectiveFps.toFixed(1)} fps thực tế (mục tiêu ${FPS})`)
  console.log(`      ${((playback.effectiveFps / FPS) * 100).toFixed(0)}% tốc độ thật, ${playback.framesAdvanced} khung trong 8s`)
  console.log(`Hình đổi thật: ${distinct}/3 ảnh chụp khác nhau khi phát`)
  console.log(`Tua : trung vị ${median.toFixed(0)}ms, xấu nhất ${worst.toFixed(0)}ms (cập nhật trạng thái)`)
  console.log(`      chi tiết: ${seeks.map((value) => value.toFixed(0)).join(', ')}ms`)
  console.log(`Tua tới lúc HÌNH đổi: trung vị ${paintMedian}ms (gồm cả giải mã video)`)
  console.log(`      chi tiết: ${paintSeeks.join(', ')}ms — độ phân giải hạn chế bởi thời gian chụp ảnh`)
  console.log(`<video> trần, cùng cách đo: trung vị ${plainMedian}ms (${plainSeeks.join(', ')}ms)`)
  console.log(`      → Remotion đắt hơn video trần: ${(paintMedian / plainMedian).toFixed(2)}× lần`)
  if (errors.length > 0) console.log(`\n⚠ Lỗi trang: ${errors.slice(0, 3).join(' | ')}`)
} finally {
  await browser?.close()
  await server?.close()
  await rm(workDir, { recursive: true, force: true })
}
