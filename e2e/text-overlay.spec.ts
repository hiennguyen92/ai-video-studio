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
 * Chữ đè lên hình, chạy thật trong app.
 *
 * Điều cần chứng minh:
 *
 *   1. chữ HIỆN trên preview đúng khoảng thời gian đã đặt, và biến mất ngoài đó
 *   2. hiệu ứng làm đổi hình (giữ nguyên đầu phát, chỉ đổi kiểu)
 *   3. nó đi được tới file xuất ra, không chỉ sống trong preview
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
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-text-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-text-work-'))
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
    'color=c=gray:size=640x360:rate=30:duration=8',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chữ')
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

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('thêm chữ được ngay cả khi chưa có bản phiên âm nào', async () => {
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()

  // Chữ overlay do người dùng tự viết nên không phụ thuộc transcript.
  await expect(page.getByText('Chưa có chữ nào.')).toBeVisible()
  await page.getByRole('button', { name: 'Thêm chữ' }).click()

  await page.getByLabel('Nội dung 1').fill('Bạn đang bỏ lỡ thứ này')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
})

test('chữ hiện trên preview trong khoảng đã đặt và biến mất ngoài đó', async () => {
  const overlay = page.locator('.text-overlay')

  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await expect(overlay).toContainText('Bạn đang bỏ lỡ thứ này')

  // Tua ra ngoài khoảng: chữ phải biến mất, không dính lại trên màn hình.
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  await page.mouse.click(box!.x + 400, box!.y + 12)
  await expect(overlay).toHaveCount(0)
})

test('đổi hiệu ứng làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')

  // Đặt đầu phát vào GIỮA hiệu ứng vào rồi giữ nguyên; đổi vị trí giữa các lần
  // chụp thì hình khác nhau dù hiệu ứng có chạy hay không.
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)

  await page.getByLabel('Hiệu ứng 1').selectOption('typewriter')
  await page.waitForTimeout(700)
  const typewriter = await stage.screenshot()

  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.waitForTimeout(700)
  const none = await stage.screenshot()

  // Gõ chữ hiện dần từng ký tự nên khung hình phải khác hẳn lúc hiện đủ ngay.
  expect(typewriter.equals(none)).toBe(false)
})

test('bật nền hộp làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const noBox = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('dark')
  await page.waitForTimeout(700)
  const darkBox = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('light')
  await page.waitForTimeout(700)
  const lightBox = await stage.screenshot()

  // Ba trạng thái phải cho ba khung hình KHÁC nhau. Hai cái giống nhau nghĩa là
  // ô chọn đổi dữ liệu mà lớp vẽ không đọc tới, và người dùng chỉnh vào hư không.
  expect(noBox.equals(darkBox)).toBe(false)
  expect(darkBox.equals(lightBox)).toBe(false)

  await page.getByLabel('Nền chữ 1').selectOption('none')
})

test('hiệu ứng ra làm chữ biến mất dần thay vì tắt phụt', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')

  // Cửa sổ hiệu ứng ra chỉ dài khoảng một phần ba giây, nên click vào thước để
  // rơi trúng nó là trò may rủi. Cách chắc chắn: tua tới ĐÚNG đầu khoảng chữ rồi
  // DỜI khoảng chữ lùi lại, để đầu phát nằm sẵn ở cuối khoảng mới.
  await page.getByLabel('Bắt đầu (giây) 1').fill('3')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.getByLabel('Bắt đầu (giây) 1').fill('2')
  await page.getByLabel('Kết thúc (giây) 1').fill('3.05')
  await page.waitForTimeout(700)

  const overlay = page.locator('.text-overlay')
  await expect(overlay).toBeVisible()

  const shots = new Map<string, string>()
  for (const exit of ['none', 'fade', 'shrink', 'slide-down']) {
    await page.getByLabel('Hiệu ứng ra 1').selectOption(exit)
    await page.waitForTimeout(700)
    shots.set(exit, (await stage.screenshot()).toString('base64'))
  }

  // Bốn trạng thái, cùng một thời điểm, phải cho bốn khung hình khác nhau. Trùng
  // nhau nghĩa là ô chọn đổi dữ liệu mà lớp vẽ không đọc tới.
  expect(new Set(shots.values()).size).toBe(shots.size)

  await page.getByLabel('Hiệu ứng ra 1').selectOption('none')
})

test('viền phát sáng làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByLabel('Hiệu ứng ra 1').selectOption('none')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByLabel('Viền phát sáng 1').check()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(false)

  // Tắt đi phải trả về ĐÚNG khung cũ; còn khác nghĩa là có phần vẽ thừa nằm lại.
  await page.getByLabel('Viền phát sáng 1').uncheck()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(true)
})

test('đổi vị trí đưa chữ xuống dưới khung hình', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const middle = await stage.screenshot()

  await page.getByLabel('Vị trí 1').selectOption('2')
  await page.waitForTimeout(700)
  const bottom = await stage.screenshot()

  expect(bottom.equals(middle)).toBe(false)
})

test('chữ đi tới file xuất ra, không chỉ sống trong preview', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })

  // Dự án có chữ overlay nên app phải TỰ chọn Remotion và khoá lựa chọn lại:
  // xuất bằng ffmpeg sẽ ra file thiếu chữ mà không báo gì.
  const engine = dialog.getByLabel('Bộ dựng hình')
  await expect(engine).toHaveValue('remotion')
  await expect(engine).toBeDisabled()
  await expect(dialog.getByText(/phải dùng Remotion/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 600_000 })

  const stats = await stat(outputPath)
  expect(stats.size).toBeGreaterThan(10_000)

  // Nguồn là màn hình XÁM TRƠN — xám chứ không đen, để hộp tối và hộp sáng đều
  // nhìn ra được. Trích một khung trong khoảng có chữ: có chữ thì khung đó không
  // còn trơn, và ảnh nén ra sẽ lớn hơn hẳn khung ngoài khoảng.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const sizes: number[] = []
  for (const [name, at] of [
    ['co-chu', '2.5'],
    ['khong-chu', '6.5']
  ] as const) {
    const framePath = join(workDir, `${name}.png`)
    await execFileAsync(String(ffmpegStatic), [
      '-v',
      'error',
      '-y',
      '-ss',
      at,
      '-i',
      outputPath,
      '-frames:v',
      '1',
      framePath
    ])
    sizes.push((await stat(framePath)).size)
  }

  expect(sizes[0]).toBeGreaterThan(sizes[1] * 1.5)
})
