import { mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from '@playwright/test'
import ffmpegStatic from 'ffmpeg-static'

const execFileAsync = promisify(execFile)
const OUT = process.argv[2]
const ffmpegPath = String(ffmpegStatic)

const userDataDir = await mkdtemp(join(tmpdir(), 'avs-shot-profile-'))
const fixtureDir = await mkdtemp(join(tmpdir(), 'avs-shot-media-'))
const video = join(fixtureDir, 'phong-van-nhan-vat.mp4')
const music = join(fixtureDir, 'nhac-nen-nhe.mp3')

await execFileAsync(ffmpegPath, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=1280x720:rate=30:duration=22',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=300:duration=22:sample_rate=48000',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'ultrafast',
  '-c:a',
  'aac',
  '-shortest',
  video
])
await execFileAsync(ffmpegPath, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=440:duration=14:sample_rate=48000',
  '-c:a',
  'libmp3lame',
  music
])

const app = await electron.launch({
  args: ['.'],
  env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
await page.setViewportSize({ width: 1440, height: 900 })

await page.screenshot({ path: join(OUT, 'ui-01-danh-sach-du-an.png') })

await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Video giới thiệu sản phẩm')
await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
await page.getByRole('region', { name: 'Timeline' }).waitFor()
await page.screenshot({ path: join(OUT, 'ui-02-workspace-trong.png') })

await app.evaluate(
  ({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  },
  [video, music]
)

await page
  .getByRole('region', { name: 'AI Studio' })
  .getByRole('button', { name: 'Nhập media' })
  .first()
  .click()
await page.locator('.media-card', { hasText: 'phong-van-nhan-vat.mp4' }).waitFor({ timeout: 90000 })
await page.locator('.media-card', { hasText: 'nhac-nen-nhe.mp3' }).waitFor({ timeout: 90000 })
await page.screenshot({ path: join(OUT, 'ui-03-thu-vien-media.png') })

// Dựng một timeline có thật: video trên track hình, nhạc trên track nhạc nền.
await page.locator('.media-card', { hasText: 'phong-van-nhan-vat.mp4' }).dblclick()
await page.locator('.media-card', { hasText: 'nhac-nen-nhe.mp3' }).dblclick()
await page.locator('.timeline-clip').first().waitFor()

// Đặt playhead giữa clip rồi cắt, để ảnh cho thấy timeline đang được dựng thật.
const ruler = await page.locator('.timeline__ruler-row').boundingBox()
await page.mouse.click(ruler.x + 420, ruler.y + 12)
await page.locator('.timeline-clip').first().click()
await page.getByRole('button', { name: 'Cắt tại playhead' }).click()
await page.locator('.timeline-clip').nth(1).click()
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'ui-04-timeline-va-inspector.png') })

await page.locator('.top-bar select').selectOption('en')
await page.waitForTimeout(300)
await page.screenshot({ path: join(OUT, 'ui-05-english.png') })

await app.close()
await rm(userDataDir, { recursive: true, force: true })
await rm(fixtureDir, { recursive: true, force: true })
console.log('captured')
