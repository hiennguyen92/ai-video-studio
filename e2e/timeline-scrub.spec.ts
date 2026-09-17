import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
 * Kéo chuột trên thước để tua.
 *
 * Điều cần chứng minh: kéo LÂU cũng không làm sập giao diện.
 *
 * Lỗi thật đã gặp: lúc DỪNG, Player vẫn bắn `frameupdate` sau mỗi lệnh tua, và
 * lớp đồng bộ đẩy nó ngược vào store — tiếng vọng của chính lệnh mình vừa gửi.
 * Kéo vài lượt là React ngã với lỗi #185 (vượt số lần cập nhật tối đa) và TỰ GỠ
 * TOÀN BỘ CÂY: cả cửa sổ trống trơn.
 *
 * **Phép thử này KHÔNG tái hiện được lỗi đó.** Đã thử làm nặng lên — chín cảnh,
 * chín dòng chữ, nguồn video 100 giây, kéo hết bề rộng thước — bản chưa vá vẫn
 * qua được. Lỗi chỉ nổ trên dự án thật với footage thật, tức là nó phụ thuộc nhịp
 * giải mã video chứ không chỉ phụ thuộc số lượng đối tượng.
 *
 * Nên đây là phép thử KHÓI: nó chốt rằng việc kéo thước vẫn chạy và giao diện còn
 * nguyên, chứ không phải một hàng rào chặn đúng lỗi cũ. Ghi rõ để người sau không
 * tưởng lầm là đã có lưới an toàn.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
const pageErrors: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-scrub-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-scrub-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  // Hình đổi theo thời gian để đo được rằng việc tua thật sự đổi khung hình.
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=1280x720:rate=30:duration=100',
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
  await page.setViewportSize({ width: 1500, height: 1000 })
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await app.evaluate(({ dialog }, media) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [media] })
  }, mediaPath)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án tua')
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

  // Dựng dự án theo hình dạng thật: chín cảnh, có chuyển cảnh, có chuyển động,
  // chín dòng chữ. Không đủ để tái hiện lỗi cũ (xem chú thích đầu file) nhưng ít
  // nhất phép thử chạy trên đúng thứ người dùng thật sự kéo.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()

  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')
  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    assets: Array<{ id: string }>
    tracks: Array<{ kind: string; clips: unknown[] }>
    textOverlays: unknown[]
    revision: number
  }
  const assetId = document.assets[0].id
  const videoTrack = document.tracks.find((track) => track.kind === 'video')!
  const base = { speed: 1, volume: 1, fadeInUs: 0, fadeOutUs: 0 }

  videoTrack.clips = Array.from({ length: 9 }, (_, index) => ({
    id: `clip_${index}`,
    assetId,
    startUs: index * 1_200_000,
    durationUs: 1_200_000,
    sourceInUs: 5_000_000 + index * 9_000_000,
    ...base,
    transitionIn: index > 0 ? { kind: 'fade', durationUs: 300_000 } : undefined,
    motion: { kind: 'zoom-in', intensity: 0.6 }
  }))

  document.textOverlays = Array.from({ length: 9 }, (_, index) => ({
    id: `text_${index}`,
    text: `Dòng chữ số ${index + 1}`,
    startUs: index * 1_200_000 + 100_000,
    endUs: index * 1_200_000 + 1_100_000,
    style: {
      fontFamily: 'Be Vietnam Pro',
      fontSizePx: 64,
      bold: true,
      italic: false,
      color: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidthPx: 3,
      shadowPx: 0,
      boxColor: '#000000',
      boxOpacity: 0.6,
      alignment: 2,
      marginLeftPx: 80,
      marginRightPx: 80,
      marginVerticalPx: 120,
      lineSpacingPx: 6,
      maxCharsPerLine: 22
    },
    animation: 'pop',
    animationDurationUs: 350_000
  }))
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')

  await page.locator('.project-card__open').first().click()
  await expect(page.locator('.timeline-clip')).toHaveCount(9)
  await expect(page.locator('.timeline-text-block--overlay')).toHaveCount(9)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

/** Kéo đi kéo lại trên thước, bước nhỏ như tay người. */
async function scrub(passes: number): Promise<void> {
  const ruler = page.locator('.timeline__ruler-row')
  const box = (await ruler.boundingBox())!
  // Kéo hết bề rộng thước, không chặn lại. Quãng kéo càng dài thì càng nhiều
  // khung hình khác nhau bị yêu cầu, và vòng lặp mới có cơ hội vượt mặt React.
  const left = box.x + 40
  const right = box.x + box.width - 40

  await page.mouse.move(left, box.y + 12)
  await page.mouse.down()
  for (let pass = 0; pass < passes; pass += 1) {
    const from = pass % 2 === 0 ? left : right
    const to = pass % 2 === 0 ? right : left
    for (let step = 0; step <= 100; step += 1) {
      await page.mouse.move(from + ((to - from) * step) / 100, box.y + 12)
    }
  }
  await page.mouse.up()
  await page.waitForTimeout(500)
}

test('kéo thước một đoạn dài thì giao diện vẫn còn nguyên', async () => {
  await scrub(8)

  // Vòng cập nhật vô tận làm React gỡ sạch cây: khung xem trước biến mất và
  // `document.body` không còn chữ nào. Kiểm đúng hai dấu hiệu đó.
  await expect(page.locator('.preview__stage')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
  expect(await page.evaluate(() => document.body.innerText.length)).toBeGreaterThan(0)
})

test('không có lỗi JavaScript nào chưa bắt trong lúc kéo', async () => {
  // Lỗi #185 là "vượt số lần cập nhật tối đa" — dấu hiệu của vòng lặp đồng bộ.
  expect(pageErrors).toEqual([])
})

test('tua tới hai chỗ khác nhau cho hai khung hình khác nhau', async () => {
  const stage = page.locator('.preview__stage')
  const ruler = page.locator('.timeline__ruler-row')
  const box = (await ruler.boundingBox())!

  await page.mouse.click(box.x + 60, box.y + 12)
  await page.waitForTimeout(900)
  const early = await stage.screenshot()

  await page.mouse.click(box.x + 400, box.y + 12)
  await page.waitForTimeout(900)
  const later = await stage.screenshot()

  // Không sập là chưa đủ: việc tua phải THẬT SỰ đổi hình. Đóng băng khung xem
  // trước cũng là một cách "không sập".
  expect(early.equals(later)).toBe(false)
})

test('bấm chọn clip nằm ngoài đầu phát thì đầu phát và preview tới đúng chỗ bấm', async () => {
  const ruler = page.locator('.timeline__ruler-row')
  const rulerBox = (await ruler.boundingBox())!
  const playhead = page.locator('.timeline__playhead')
  const stage = page.locator('.preview__stage')

  // Đầu phát về gần đầu timeline, rồi chụp preview ở đó.
  await page.mouse.click(rulerBox.x + 2, rulerBox.y + 12)
  await page.waitForTimeout(700)
  const atStart = await stage.screenshot()

  // Phóng timeline cho clip đủ rộng: clip ngắn thì biểu tượng transition ở hai đầu
  // che gần hết, bấm giữa clip là trúng biểu tượng.
  const timeline = page.getByRole('region', { name: 'Timeline' })
  for (let i = 0; i < 3; i += 1) await timeline.getByRole('button', { name: 'Phóng to' }).click()

  // Clip thứ ba nằm xa đầu phát: bấm vào giữa nó.
  const clip = page.locator('.timeline-clip').nth(2)
  await clip.scrollIntoViewIfNeeded()
  const clipBox = (await clip.boundingBox())!
  const clickX = clipBox.x + clipBox.width / 2
  await clip.click({ position: { x: clipBox.width / 2, y: clipBox.height / 2 } })
  await expect(clip).toHaveClass(/timeline-clip--selected/)

  await expect
    .poll(async () => Math.abs((await playhead.boundingBox())!.x - clickX))
    .toBeLessThan(4)
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(atStart)).toBe(false)

  // Đầu phát đã nằm trong clip: bấm chỗ khác trong CÙNG clip thì giữ nguyên, để
  // "đặt đầu phát → chọn clip → cắt" không bị xô điểm cắt.
  const before = (await playhead.boundingBox())!.x
  // Tránh hai đầu clip: biểu tượng transition ở chỗ nối che mất phần mép.
  await clip.click({ position: { x: 40, y: clipBox.height / 2 } })
  await page.waitForTimeout(300)
  expect(Math.abs((await playhead.boundingBox())!.x - before)).toBeLessThan(1)
})
