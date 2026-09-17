import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, stat } from 'node:fs/promises'
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
 * Xuất video bằng Remotion, chạy thật trong app.
 *
 * Điều cần chứng minh: cùng một bản dựng, đường Remotion cho ra một file MP4 phát
 * được, đúng kích thước và thời lượng — tức là composition dùng chung với preview
 * thật sự render được, chứ không chỉ biên dịch trôi.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-remotion-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-remotion-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=6:sample_rate=48000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    mediaPath
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.media] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { media: mediaPath, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án Remotion')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('đưa media lên timeline', async () => {
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('hộp thoại xuất cho chọn bộ dựng và nói rõ đánh đổi', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })

  const engine = dialog.getByLabel('Bộ dựng hình')
  await expect(engine).toBeVisible()
  // Mặc định vẫn là ffmpeg: Remotion chậm hơn mà chưa đổi lại được tính năng nào.
  await expect(engine).toHaveValue('ffmpeg')
  await expect(dialog.locator('.export-dialog__hint')).toContainText('ffmpeg')
})

test('xuất bằng Remotion ra file MP4 phát được', async () => {
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByLabel('Bộ dựng hình').selectOption('remotion')
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()

  // Lần đầu phải dựng bundle Remotion nên chậm hơn hẳn các lần sau.
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 600_000 })

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
  expect(video).toBeDefined()
  // Kích thước lấy từ thiết lập dự án, không phải giá trị đặt cứng trong root.tsx.
  expect(video?.width).toBe(1920)
  expect(video?.height).toBe(1080)

  // Clip dài 6 giây; container cho phép lệch nhỏ.
  const duration = Number(probed.format.duration)
  expect(duration).toBeGreaterThan(5.5)
  expect(duration).toBeLessThan(6.5)
})
