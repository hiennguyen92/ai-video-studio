import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
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
 * Chuyển động trong clip, chạy thật trong app.
 *
 * Nguồn là một LƯỚI TĨNH trên nền đỏ, cố ý:
 *
 *   - màu trơn thì phóng to hay lia đều cho ra khung hình y hệt, và phép thử sẽ
 *     xanh trong khi hiệu ứng không hề chạy
 *   - hình tĩnh thì mọi khác biệt giữa hai khung CHỈ có thể do chuyển động,
 *     không thể do nội dung video tự đổi theo thời gian
 *
 * Đầu phát cũng được giữ NGUYÊN giữa các lần chụp: dời đầu phát rồi so ảnh thì
 * ảnh khác nhau kể cả khi không có hiệu ứng nào.
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
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-motion-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-motion-work-'))
  mediaPath = join(workDir, 'luoi.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=red:size=640x360:rate=30:duration=10',
    '-vf',
    'drawgrid=w=40:h=40:t=3:color=white',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chuyển động')
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

const inspector = (): ReturnType<Page['getByRole']> =>
  page.getByRole('region', { name: 'Thuộc tính' })

/** Đặt đầu phát vào GIỮA clip rồi giữ nguyên suốt các lần chụp. */
async function seekToMiddle(): Promise<void> {
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  await page.mouse.click(box!.x + box!.width * 0.35, box!.y + 12)
  await page.waitForTimeout(700)
}

test('Inspector hiện ô chuyển động cho clip hình, mặc định là đứng yên', async () => {
  await page.locator('.timeline-clip').first().click()

  const select = inspector().getByLabel('Chuyển động', { exact: true })
  await expect(select).toBeVisible()
  await expect(select).toHaveValue('')
  // Chưa chọn gì thì không có thanh cường độ — bày ra một thanh không tác dụng gì
  // là đúng thứ DESCRIPTION §3.B cấm.
  await expect(inspector().getByLabel('Cường độ')).toHaveCount(0)
})

test('mỗi kiểu chuyển động cho ra một khung hình khác nhau, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await seekToMiddle()

  const select = inspector().getByLabel('Chuyển động', { exact: true })

  await select.selectOption('')
  await page.waitForTimeout(700)
  const still = await stage.screenshot()

  await select.selectOption('zoom-in')
  await expect(inspector().getByLabel('Cường độ')).toBeVisible()
  await page.waitForTimeout(700)
  const zoomed = await stage.screenshot()

  await select.selectOption('pan-left')
  await page.waitForTimeout(700)
  const panned = await stage.screenshot()

  // Ba trạng thái phải cho ba khung hình khác nhau. Giống nhau nghĩa là ô chọn
  // đổi dữ liệu mà lớp vẽ không đọc tới.
  expect(still.equals(zoomed)).toBe(false)
  expect(still.equals(panned)).toBe(false)
  expect(zoomed.equals(panned)).toBe(false)
})

test('cường độ 0 đưa khung hình về đúng như khi đứng yên', async () => {
  const stage = page.locator('.preview__stage')
  const select = inspector().getByLabel('Chuyển động', { exact: true })

  await select.selectOption('')
  await page.waitForTimeout(700)
  const still = await stage.screenshot()

  await select.selectOption('zoom-in')
  await inspector().getByLabel('Cường độ').fill('0')
  await page.waitForTimeout(700)

  // Cường độ 0 mà vẫn thấy khác nghĩa là có một phép biến đổi thừa nằm lại trong
  // đường vẽ, và nó sẽ làm mờ hình trên MỌI clip.
  expect((await stage.screenshot()).equals(still)).toBe(true)
})

test('lia máy nói rõ hình bị cắt bớt', async () => {
  await inspector().getByLabel('Chuyển động', { exact: true }).selectOption('pan-right')
  await expect(inspector().getByText(/phóng nền lên/)).toBeVisible()

  await inspector().getByLabel('Chuyển động', { exact: true }).selectOption('zoom-in')
  await expect(inspector().getByText(/phóng nền lên/)).toHaveCount(0)
})

test('chỉnh màu làm đổi hình, và mỗi thông số đổi một kiểu khác nhau', async () => {
  const stage = page.locator('.preview__stage')
  await inspector().getByLabel('Chuyển động', { exact: true }).selectOption('')
  await seekToMiddle()

  const neutral = await stage.screenshot()

  const shots = new Map<string, string>()
  for (const [label, value] of [
    ['Độ sáng', '1.4'],
    ['Tương phản', '1.4'],
    ['Độ bão hoà', '0'],
    ['Nhiệt độ màu', '1'],
    ['Tối góc', '1']
  ] as const) {
    await inspector().getByLabel(label).fill(value)
    await page.waitForTimeout(700)
    shots.set(label, (await stage.screenshot()).toString('base64'))
    await inspector().getByRole('button', { name: 'Về màu gốc' }).click()
    await page.waitForTimeout(500)
  }

  for (const [label, image] of shots) {
    expect(image, `"${label}" không làm đổi hình`).not.toBe(neutral.toString('base64'))
  }

  // Và năm thông số phải đổi hình theo năm cách KHÁC nhau; trùng nhau nghĩa là có
  // thanh trượt đang nối nhầm vào cùng một chỗ.
  expect(new Set(shots.values()).size).toBe(shots.size)
})

test('nút về màu gốc trả đúng khung hình ban đầu', async () => {
  const stage = page.locator('.preview__stage')
  await page.waitForTimeout(500)
  const neutral = await stage.screenshot()

  await inspector().getByLabel('Tương phản').fill('1.45')
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(neutral)).toBe(false)

  await inspector().getByRole('button', { name: 'Về màu gốc' }).click()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(neutral)).toBe(true)
})

test('giao diện nói thẳng là chưa hỗ trợ LUT', async () => {
  // Bày một ô "LUT" chỉnh gần đúng bằng mấy bộ lọc chắp vá là đúng thứ §3.B cấm;
  // nói ra giới hạn là cách trung thực duy nhất.
  await expect(inspector().getByText(/Chưa hỗ trợ LUT/)).toBeVisible()
})

test('chuyển động đi tới file xuất ra, không chỉ sống trong preview', async () => {
  await inspector().getByLabel('Chuyển động', { exact: true }).selectOption('zoom-in')
  await inspector().getByLabel('Cường độ').fill('1')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  // Chuyển động chỉ vẽ được bằng Remotion; ffmpeg sẽ cho ra file thiếu hiệu ứng.
  const engine = dialog.getByLabel('Bộ dựng hình')
  await expect(engine).toHaveValue('remotion')
  await expect(engine).toBeDisabled()
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 600_000 })

  expect((await stat(outputPath)).size).toBeGreaterThan(10_000)

  // Nguồn là hình TĨNH, nên hai khung ở hai thời điểm chỉ có thể khác nhau nếu
  // chuyển động thật sự được nung vào file.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const frames: Buffer[] = []
  for (const [name, at] of [
    ['dau', '0.2'],
    ['cuoi', '9.5']
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
    frames.push(await readFile(framePath))
  }

  expect(frames[0].equals(frames[1])).toBe(false)
})
