// Chạy thử BẢN ĐÓNG GÓI: nhập media, dựng một clip, xuất bằng Remotion.
// Đây là đường duy nhất chứng minh gói cài chạy được — build xong không nói gì.
import { _electron as electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const execFileAsync = promisify(execFile)

const APP =
  process.env.APP ??
  join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    'dist',
    'mac-arm64',
    'ai-video-studio.app',
    'Contents',
    'MacOS',
    'ai-video-studio'
  )
const work = await mkdtemp(join(tmpdir(), 'avs-smoke-'))
const userData = await mkdtemp(join(tmpdir(), 'avs-smoke-data-'))
const media = join(work, 'canh-quay.mp4')
const output = join(work, 'ket-qua.mp4')

const { default: ffmpegStatic } = await import('ffmpeg-static')
await execFileAsync(String(ffmpegStatic), [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=c=teal:size=320x180:rate=30:duration=3',
  '-vf',
  'drawgrid=w=40:h=40:t=3:color=white',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-preset',
  'ultrafast',
  media
])

const app = await electron.launch({
  executablePath: APP,
  args: [],
  env: { ...process.env, AVS_USER_DATA_DIR: userData, NODE_ENV: 'production' }
})
// Bắt luôn stderr của tiến trình main: app tắt giữa chừng thì lỗi chỉ nằm ở đây.
app.process().stderr?.on('data', (chunk) => process.stdout.write(`[main] ${chunk}`))
app.process().stdout?.on('data', (chunk) => process.stdout.write(`[main-out] ${chunk}`))

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[renderer]', m.text())
})
console.log('app mở được')

await app.evaluate(
  ({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.media] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
  },
  { media, output }
)

await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Thử bản cài')
await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
await page.getByRole('region', { name: 'Timeline' }).waitFor()

await page
  .getByRole('region', { name: 'AI Studio' })
  .getByRole('button', { name: 'Nhập media' })
  .first()
  .click()
await page.locator('.media-card').first().waitFor({ timeout: 120_000 })
// Nhập được nghĩa là ffprobe và ffmpeg trong gói chạy được (probe + thumbnail).
console.log('ffmpeg/ffprobe trong gói: OK')

await page.locator('.media-card').first().dblclick()
await page.locator('.timeline-clip').first().waitFor()

// Đặt chuyển động để buộc app dùng đường Remotion, không rơi về ffmpeg.
await page.locator('.timeline-clip').first().click()
await page
  .getByRole('region', { name: 'Thuộc tính' })
  .getByLabel('Chuyển động', { exact: true })
  .selectOption('zoom-in')

await page.getByRole('button', { name: 'Xuất video' }).click()
const dialog = page.getByRole('dialog', { name: 'Xuất video' })
console.log('bộ dựng:', await dialog.getByLabel('Bộ dựng hình').inputValue())
await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
await dialog.getByText('Xuất xong').waitFor({ timeout: 900_000 })

const stats = await stat(output)
console.log(`xuất được ${(stats.size / 1024).toFixed(0)} KB`)

const { default: ffprobe } = await import('@ffprobe-installer/ffprobe')
const { stdout } = await execFileAsync(ffprobe.path, [
  '-v',
  'error',
  '-show_entries',
  'format=duration',
  '-of',
  'csv=p=0',
  output
])
console.log('thời lượng file xuất:', stdout.trim())

await app.close()
console.log('SMOKE OK')
