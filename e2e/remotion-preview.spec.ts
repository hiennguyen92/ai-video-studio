import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
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
 * Preview chạy bằng Remotion Player.
 *
 * Điều cần chứng minh không phải "có khung hình" mà là ba thứ dễ hỏng âm thầm:
 *
 *   1. hình THẬT SỰ được vẽ (so ảnh chụp, không tin vào đồng hồ)
 *   2. phát làm đầu phát tiến lên — Player đẩy trạng thái về store
 *   3. bấm trên timeline thì Player tua theo — chiều ngược lại
 *
 * Chiều 2 và 3 nối vòng với nhau; sai một chút là treo hoặc giật vô hạn.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-preview-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-preview-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=10:sample_rate=48000',
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

  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, mediaPath)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án preview')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const stage = (): ReturnType<Page['locator']> => page.locator('.preview__stage')

test('media nạp qua http cục bộ, không phải đường dẫn đĩa', async () => {
  // Remotion không đọc được file tuỳ ý; thẻ video phải trỏ vào máy chủ cục bộ.
  const src = await page.locator('.preview__stage video').first().getAttribute('src')
  expect(src).toContain('127.0.0.1')
  expect(src).toContain('/media/')
})

test('khung hình được vẽ thật, không phải ô đen', async () => {
  await page.waitForTimeout(1500)
  const shot = await stage().screenshot()

  // Ảnh chụp một ô đen tuyền nén rất nhỏ; có hình thật thì lớn hơn hẳn.
  expect(shot.byteLength).toBeGreaterThan(5000)
})

test('phát làm đầu phát tiến lên và hình đổi theo', async () => {
  const before = await stage().screenshot()

  await page.getByRole('button', { name: 'Phát' }).click()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Tạm dừng' }).click()

  // Timecode do store cấp; nó nhúc nhích nghĩa là Player đã đẩy trạng thái về.
  const timecode = await page.locator('.preview__timecode').textContent()
  expect(timecode).not.toContain('00:00:00:00')

  const after = await stage().screenshot()
  expect(after.equals(before)).toBe(false)
})

test('bấm trên thước thời gian thì Player tua theo', async () => {
  const before = await stage().screenshot()

  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + 220, box!.y + 12)

  await page.waitForTimeout(1200)
  const after = await stage().screenshot()
  // Tua tới chỗ khác thì hình phải khác — đây là chiều store → Player.
  expect(after.equals(before)).toBe(false)
})

test('đồng bộ hai chiều không tạo vòng lặp: đầu phát đứng yên khi không thao tác', async () => {
  await page.waitForTimeout(800)
  const first = await page.locator('.preview__timecode').textContent()
  await page.waitForTimeout(1200)
  const second = await page.locator('.preview__timecode').textContent()

  // Không phát thì timecode phải bất động. Nhúc nhích nghĩa là hai chiều đồng bộ
  // đang đẩy qua đẩy lại nhau.
  expect(second).toBe(first)
})
