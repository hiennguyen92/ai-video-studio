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
 * Lane ảnh, chạy thật trong app.
 *
 * Điều cần chứng minh:
 *
 *   1. ảnh nhập được vào thư viện media và nhận đúng loại
 *   2. có lane ảnh riêng, và ảnh rơi vào đó chứ không lẫn vào lane hình
 *   3. ảnh HIỆN RA trên preview — đây là chỗ dễ hỏng lặng lẽ nhất, vì lớp vẽ
 *      cũ đưa mọi clip cho `OffthreadVideo`, và ảnh qua đó chỉ ra một ô trống
 *   4. ảnh đi tới file xuất ra, không chỉ sống trong preview
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let imagePath: string
let videoPath: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-img-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-img-work-'))
  imagePath = join(workDir, 'logo-thu.png')
  videoPath = join(workDir, 'canh-quay.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  // Ảnh MỘT MÀU rực rỡ: dễ đo có mặt trong khung hình hay không.
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=#FF00AA:size=200x200',
    '-frames:v',
    '1',
    imagePath
  ])
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:size=640x360:rate=30:duration=5',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    videoPath
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [paths.video, paths.image]
      })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { video: videoPath, image: imagePath, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án ảnh')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const timeline = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'Timeline' })

test('ảnh nhập được vào thư viện media', async () => {
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 90_000 })
  await expect(page.locator('.media-card', { hasText: 'logo-thu.png' })).toBeVisible()
})

test('nút Thêm track hình ảnh tạo lane riêng, và ảnh rơi vào đó', async () => {
  await page.locator('.media-card', { hasText: 'canh-quay.mp4' }).dblclick()
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(1)

  await timeline().getByRole('button', { name: 'Thêm track hình ảnh' }).click()
  await expect(page.locator('.timeline-lane--image')).toHaveCount(1)

  await page.locator('.media-card', { hasText: 'logo-thu.png' }).dblclick()

  // Ảnh phải vào lane ảnh, không lẫn vào lane hình bên cạnh clip quay.
  await expect(page.locator('.timeline-lane--image .timeline-clip')).toHaveCount(1)
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(1)
})

test('ảnh HIỆN RA trên preview, không phải một ô trống', async () => {
  // Đưa đầu phát vào giữa khoảng của ảnh.
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  await page.mouse.click(box!.x + 60, box!.y + 12)
  await page.waitForTimeout(700)

  const stage = page.locator('.preview__stage')
  const shot = await stage.screenshot()

  // Đếm điểm ảnh mang màu của tấm ảnh. Đưa ảnh cho `OffthreadVideo` thì không có
  // lỗi nào cả, chỉ là khung hình đen trơn — nên phải đo màu, không đo DOM.
  const { writeFile } = await import('node:fs/promises')
  const shotPath = join(workDir, 'preview.png')
  await writeFile(shotPath, shot)
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stdout } = await execFileAsync(
    String(ffmpegStatic),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      shotPath,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-'
    ],
    { encoding: 'buffer', maxBuffer: 1 << 28 }
  )

  let hong = 0
  for (let index = 0; index < stdout.length; index += 3) {
    if (stdout[index] > 180 && stdout[index + 1] < 90 && stdout[index + 2] > 110) hong++
  }
  expect(hong).toBeGreaterThan(500)
})

test('ảnh đi tới file xuất ra, không chỉ sống trong preview', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  await page.getByRole('button', { name: 'Chọn nơi lưu…' }).click()

  // Dự án có ảnh nên phải dùng Remotion; ffmpeg không đọc được ảnh tĩnh theo
  // trục thời gian của video.
  await expect(page.getByText('Dự án có chuyển cảnh')).toBeVisible()

  await page.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(page.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })
  expect((await stat(outputPath)).size).toBeGreaterThan(1000)

  // Kích thước file không chứng minh được gì: một video đen trơn cũng nặng chừng
  // đó. Rút một khung nằm trong khoảng của ảnh rồi ĐẾM MÀU.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stdout } = await execFileAsync(
    String(ffmpegStatic),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      '1',
      '-i',
      outputPath,
      '-frames:v',
      '1',
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-'
    ],
    { encoding: 'buffer', maxBuffer: 1 << 28 }
  )

  let hong = 0
  for (let index = 0; index < stdout.length; index += 3) {
    if (stdout[index] > 180 && stdout[index + 1] < 90 && stdout[index + 2] > 110) hong++
  }
  expect(hong).toBeGreaterThan(500)
})
