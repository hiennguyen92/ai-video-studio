import { mkdtemp, rm, stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'

/**
 * Kiểm thử đầu-cuối luồng xuất video: bấm nút trong giao diện và soi file thật.
 *
 * Đây là phép thử quyết định cho Mốc 1 — "export hoạt động" chỉ được coi là đạt
 * khi có một file MP4 phát được nằm trên đĩa, không phải khi thanh tiến trình chạy hết.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let videoFixture: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-export-profile-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-export-work-'))
  videoFixture = join(workDir, 'canh-quay.mp4')
  outputPath = join(workDir, 'ket-qua-xuat.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=5:sample_rate=48000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    videoFixture
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Thay cả hộp thoại mở file lẫn hộp thoại lưu file bằng đường dẫn cố định.
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.input] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { input: videoFixture, output: outputPath }
  )
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

test('xuất MP4 từ giao diện và file kết quả phát được', async () => {
  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án xuất thử')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card', { hasText: 'canh-quay.mp4' }).waitFor({ timeout: 90_000 })
  await page.locator('.media-card', { hasText: 'canh-quay.mp4' }).dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await expect(dialog).toBeVisible()

  // Nút bắt đầu phải bị khoá cho tới khi chọn được nơi lưu.
  await expect(dialog.getByRole('button', { name: 'Bắt đầu xuất' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await expect(dialog.getByRole('button', { name: 'Bắt đầu xuất' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 120_000 })

  // Phép thử thật nằm ở đây: file trên đĩa có đúng nội dung không.
  const stats = await stat(outputPath)
  expect(stats.size).toBeGreaterThan(10_000)

  const { default: ffprobeInstaller } = await import('@ffprobe-installer/ffprobe')
  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    outputPath
  ])
  const probed = JSON.parse(stdout) as {
    streams: Array<{ codec_type: string; width?: number; height?: number }>
    format: { duration: string }
  }

  const video = probed.streams.find((stream) => stream.codec_type === 'video')
  const audio = probed.streams.find((stream) => stream.codec_type === 'audio')
  expect(video).toBeDefined()
  expect(audio).toBeDefined()
  expect(video?.width).toBe(1920)
  expect(video?.height).toBe(1080)

  // Timeline dài 5 giây; container cho phép lệch nhỏ.
  const duration = Number(probed.format.duration)
  expect(duration).toBeGreaterThan(4.7)
  expect(duration).toBeLessThan(5.4)
})
