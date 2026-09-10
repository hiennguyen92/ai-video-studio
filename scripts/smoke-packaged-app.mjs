// Chạy thử BẢN ĐÓNG GÓI: nhập media, dựng một clip, xuất bằng Remotion.
// Đây là đường duy nhất chứng minh gói cài chạy được — build xong không nói gì.
import { _electron as electron } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const execFileAsync = promisify(execFile)

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const builtApp = join(projectRoot, 'dist', 'mac-arm64', 'AI Video Studio.app')

/**
 * Chép bản đóng gói ra NGOÀI cây dự án rồi mới chạy.
 *
 * Chạy tại chỗ là xanh giả: Node giải gói bằng cách trèo ngược thư mục, nên từ
 * `dist/…/app/node_modules` nó trèo tới `node_modules` của máy dev và tìm thấy
 * cả những gói KHÔNG hề nằm trong gói cài. Bản cài thật ở /Applications không có
 * tổ tiên nào như vậy, và lỗi thiếu gói chỉ lộ ra ở đó.
 */
async function stageOutsideProject() {
  // Cùng ổ đĩa thì `cp -c` dùng clonefile của APFS: gần như tức thì, gần như
  // không tốn chỗ. Khác ổ thì clonefile không làm được, phải chép thật.
  const sameVolume = await mkdtemp(join(dirname(projectRoot), '.avs-smoke-app-'))
  try {
    await execFileAsync('cp', ['-Rc', builtApp, sameVolume])
    return sameVolume
  } catch {
    await rm(sameVolume, { recursive: true, force: true })
    const fallback = await mkdtemp(join(tmpdir(), 'avs-smoke-app-'))
    await execFileAsync('cp', ['-R', builtApp, fallback])
    return fallback
  }
}

/** Chốt chặn: còn tổ tiên nào có node_modules thì phép thử lại vô nghĩa. */
function assertNoAncestorModules(path) {
  for (let dir = path; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, 'node_modules'))) {
      throw new Error(`Chỗ chạy thử vẫn nằm dưới một node_modules: ${dir}`)
    }
  }
}

const stagedRoot = process.env.APP ? null : await stageOutsideProject()
if (stagedRoot) assertNoAncestorModules(stagedRoot)

const APP =
  process.env.APP ?? join(stagedRoot, 'AI Video Studio.app', 'Contents', 'MacOS', 'AI Video Studio')
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
  // Mở từ Finder thì thư mục làm việc là `/`, không phải thư mục dự án. Chạy thử
  // với cwd của terminal là xanh giả: mọi đường dẫn TƯƠNG ĐỐI đều rơi vào thư mục
  // dự án đang ghi được, còn ở máy người dùng thì rơi vào `/` và ngã.
  cwd: '/',
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
if (stagedRoot) await rm(stagedRoot, { recursive: true, force: true })
console.log('SMOKE OK')
