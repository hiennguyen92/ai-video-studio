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

/** Đọc biến đổi của clip ảnh từ chính file dự án đã lưu. */
async function savedImageTransform(): Promise<{
  x: number
  y: number
  scale: number
  rotationDeg: number
}> {
  const { readFile, readdir } = await import('node:fs/promises')
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const doc = JSON.parse(await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')) as {
    tracks: Array<{
      kind: string
      clips: Array<{ transform?: { x: number; y: number; scale: number; rotationDeg: number } }>
    }>
  }
  return doc.tracks.find((track) => track.kind === 'image')!.clips[0].transform!
}

test('kéo ảnh trên khung xem trước thì ảnh dời theo', async () => {
  await page.locator('.timeline-lane--image .timeline-clip').first().click()

  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const image = page.locator('.preview__stage img[data-clip-id]').first()
  const before = await image.boundingBox()

  await gizmo.hover()
  const box = await gizmo.boundingBox()
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + box!.height / 2 - 40, { steps: 8 })
  await page.mouse.up()

  await expect.poll(async () => (await image.boundingBox())!.x).toBeGreaterThan(before!.x + 20)

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const transform = await savedImageTransform()
  // Đơn vị là TỈ LỆ khung hình (-1..1), không phải pixel: kéo 70px trên khung xem
  // trước phải ra một phân số nhỏ, không phải con số 70.
  expect(transform.x).toBeGreaterThan(0)
  expect(transform.x).toBeLessThan(1)
})

test('có tay nắm ở CẢ BỐN góc, và tay nắm nào cũng bấm tới được', async () => {
  await page.locator('.timeline-lane--image .timeline-clip').first().click()
  await expect(page.locator('.preview-gizmo')).toBeVisible()

  const handles = page.locator('.preview-gizmo__resize')
  await expect(handles).toHaveCount(4)

  // Tay nắm nằm ngoài vùng xem trước là tay nắm không bấm được: đo được là
  // thanh tiêu đề của app chặn luôn cú bấm.
  const inside = await page.evaluate(() => {
    const stage = document.querySelector('.preview__stage')!.getBoundingClientRect()
    return [...document.querySelectorAll('.preview-gizmo__resize')].every((node) => {
      const r = node.getBoundingClientRect()
      return (
        r.left >= stage.left - 1 &&
        r.right <= stage.right + 1 &&
        r.top >= stage.top - 1 &&
        r.bottom <= stage.bottom + 1
      )
    })
  })
  expect(inside).toBe(true)

  // Và mỗi tay nắm phải thật sự nhận được cú hover, không bị thứ khác che.
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    await page.locator(`.preview-gizmo__resize--${corner}`).hover({ timeout: 5000 })
  }
})

test('kéo góc thì đổi cỡ ảnh', async () => {
  await page.locator('.timeline-lane--image .timeline-clip').first().click()
  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const image = page.locator('.preview__stage img[data-clip-id]').first()
  const before = await image.boundingBox()
  const beforeScale = (await savedImageTransform()).scale

  // Kéo góc TRÊN-TRÁI: bốn góc dùng chung một phép tính theo khoảng cách tới
  // tâm, nên góc nào cũng phải phóng được, không riêng góc dưới-phải.
  const handle = page.locator('.preview-gizmo__resize--tl')
  await handle.hover()
  const box = await gizmo.boundingBox()
  await page.mouse.down()
  // Kéo RA XA tâm (lên trên-trái): ảnh phải to lên.
  await page.mouse.move(box!.x - 80, box!.y - 60, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(before!.width + 10)

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  expect((await savedImageTransform()).scale).toBeGreaterThan(beforeScale)
})

test('kéo tay nắm tròn thì xoay ảnh', async () => {
  await page.locator('.timeline-lane--image .timeline-clip').first().click()
  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const handle = page.locator('.preview-gizmo__rotate')
  await handle.hover()
  const box = await gizmo.boundingBox()
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y - 30, { steps: 8 })
  await page.mouse.up()

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  expect((await savedImageTransform()).rotationDeg).toBeGreaterThan(0)
})

test('hiệu ứng ra làm ảnh mờ dần ở cuối, không tắt phụt', async () => {
  await page.locator('.timeline-lane--image .timeline-clip').first().click()
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await inspector.getByLabel('Hiệu ứng ra', { exact: true }).selectOption('fade')

  const opacityAt = async (): Promise<number> => {
    const wrapper = page.locator('.preview__stage img[data-clip-id]').first()
    return Number(
      await wrapper.evaluate((node) => {
        const parent = node.parentElement as HTMLElement
        return getComputedStyle(parent).opacity
      })
    )
  }

  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  // Giữa clip: rõ hẳn.
  await page.mouse.click(box!.x + 60, box!.y + 12)
  await page.waitForTimeout(500)
  const giua = await opacityAt()

  // Sát cuối clip: phải mờ hơn hẳn.
  await page.mouse.click(box!.x + 285, box!.y + 12)
  await page.waitForTimeout(500)
  const cuoi = await opacityAt()

  expect(giua).toBeGreaterThan(0.9)
  expect(cuoi).toBeLessThan(giua - 0.2)
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
