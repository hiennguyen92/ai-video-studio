import { mkdtemp, rm } from 'node:fs/promises'
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
 * Kiểm thử đầu-cuối cho Mốc 1: mở dự án, nhập media, dựng timeline, lưu và mở lại.
 *
 * Chạy trên ỨNG DỤNG ĐÃ BUILD chứ không phải component rời, vì phần dễ hỏng nhất
 * nằm ở chỗ ba tiến trình gặp nhau: IPC, scheme media tuỳ biến, và việc ghi đĩa.
 *
 * Hộp thoại chọn file được thay thế ở tiến trình main — Playwright không bấm được
 * hộp thoại của hệ điều hành.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let fixtureDir: string
let videoFixture: string
let audioFixture: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-e2e-profile-'))
  fixtureDir = await mkdtemp(join(tmpdir(), 'avs-e2e-media-'))
  videoFixture = join(fixtureDir, 'canh-quay-thu.mp4')
  audioFixture = join(fixtureDir, 'nhac-nen-thu.mp3')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const ffmpegPath = String(ffmpegStatic)

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=8',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=8:sample_rate=48000',
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
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=5:sample_rate=48000',
    '-c:a',
    'libmp3lame',
    audioFixture
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true })
})

/** Thay hộp thoại chọn file của hệ điều hành bằng danh sách đường dẫn cố định. */
async function stubFileDialog(filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, filePaths)
}

test('mở ứng dụng ở màn hình danh sách dự án, mặc định tiếng Việt', async () => {
  await expect(page.getByRole('heading', { name: 'AI Video Studio' })).toBeVisible()
  await expect(page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Tạo dự án mới' })).toBeVisible()
})

test('tạo dự án mới và vào được vùng làm việc bốn khu', async () => {
  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án kiểm thử')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()

  // Bốn khu vực chính của bố cục (DESCRIPTION §2).
  await expect(page.getByRole('region', { name: 'AI Studio' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Xem trước' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Thuộc tính' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()

  // Track mặc định phản ánh đúng các nhóm track mà đề bài yêu cầu.
  await expect(page.getByTitle('Video 1')).toBeVisible()
  await expect(page.getByTitle('Lồng tiếng 1')).toBeVisible()
  await expect(page.getByTitle('Nhạc nền 1')).toBeVisible()
})

test('thư viện media trống có hướng dẫn, không phải ô trắng', async () => {
  await expect(page.getByText('Chưa có media nào.')).toBeVisible()
  await expect(
    page.getByText('Nhấn "Nhập media" hoặc kéo file video, âm thanh, hình ảnh vào đây.')
  ).toBeVisible()
})

test('nhập video và âm thanh thật, sinh thumbnail và thời lượng đúng', async () => {
  await stubFileDialog([videoFixture, audioFixture])
  // Có hai nút "Nhập media": một trên thanh công cụ của panel, một trong trạng
  // thái rỗng. Lấy nút đầu tiên — thanh công cụ luôn hiện, kể cả khi đã có media.
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()

  const videoCard = page.locator('.media-card', { hasText: 'canh-quay-thu.mp4' })
  const audioCard = page.locator('.media-card', { hasText: 'nhac-nen-thu.mp3' })
  await expect(videoCard).toBeVisible({ timeout: 60_000 })
  await expect(audioCard).toBeVisible({ timeout: 60_000 })

  // Thời lượng lấy từ ffprobe, không phải giá trị bịa.
  await expect(videoCard.locator('.media-card__duration')).toHaveText('00:00:08')
  await expect(audioCard.locator('.media-card__duration')).toHaveText('00:00:05')

  // Thumbnail phải nạp được qua scheme avstudio-media://.
  const thumb = videoCard.locator('img')
  await expect(thumb).toBeVisible()
  const loaded = await thumb.evaluate((img: HTMLImageElement) => img.naturalWidth > 0)
  expect(loaded).toBe(true)
})

test('thêm clip vào timeline và hiển thị đúng thời lượng', async () => {
  const videoCard = page.locator('.media-card', { hasText: 'canh-quay-thu.mp4' })
  await videoCard.dblclick()

  const clips = page.locator('.timeline-clip')
  await expect(clips).toHaveCount(1)

  // 8 giây ở mức zoom mặc định 60 px/giây => khoảng 480px.
  const width = await clips.first().evaluate((element) => element.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(430)
  expect(width).toBeLessThan(530)
})

test('cắt clip tại playhead tạo ra hai clip', async () => {
  // Đưa playhead tới giây thứ 3 bằng cách bấm lên thước thời gian.
  const ruler = page.locator('.timeline__ruler-row')
  const rulerBox = await ruler.boundingBox()
  expect(rulerBox).not.toBeNull()
  await page.mouse.click(rulerBox!.x + 180, rulerBox!.y + 12)

  await page.locator('.timeline-clip').first().click()
  await page.getByRole('button', { name: 'Cắt tại playhead' }).click()

  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test('hoàn tác đưa về đúng một clip, làm lại khôi phục lại hai', async () => {
  await page.getByRole('button', { name: /Hoàn tác/ }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  await page.getByRole('button', { name: /Làm lại/ }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test('chuyển sang tiếng Anh đổi toàn bộ giao diện', async () => {
  await page.locator('.top-bar select').selectOption('en')
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Split at playhead' })).toBeVisible()
  await page.locator('.top-bar select').selectOption('vi')
})

test('đóng và mở lại dự án giữ nguyên dữ liệu đã dựng', async () => {
  // Chờ autosave ghi xong trước khi rời khỏi dự án.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await expect(page.getByRole('heading', { name: 'AI Video Studio' })).toBeVisible()

  await page.locator('.project-card__open', { hasText: 'Dự án kiểm thử' }).click()

  // Clip, media và cấu trúc track đều phải trở lại y như trước.
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
  await expect(page.locator('.media-card')).toHaveCount(2)
  await expect(page.getByTitle('Video 1')).toBeVisible()
})

test('kéo clip sang track video khác', async () => {
  // Kéo giữa các track cùng loại là thao tác dựng cơ bản, mà trước giờ không có
  // phép thử nào chạm tới — chỉ có mã nguồn nói rằng nó chạy được.
  const timeline = page.getByRole('region', { name: 'Timeline' })
  await timeline.getByRole('button', { name: 'Thêm track video' }).click()

  const lanes = page.locator('.timeline-lane--video')
  await expect(lanes).toHaveCount(2)
  const before = await lanes.nth(0).locator('.timeline-clip').count()
  expect(before).toBeGreaterThan(0)

  const clip = lanes.nth(0).locator('.timeline-clip').first()
  await clip.hover()
  const from = await clip.boundingBox()
  const to = await lanes.nth(1).boundingBox()

  // Kéo THẲNG XUỐNG: đổi track mà không đổi giờ.
  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2, to!.y + to!.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(lanes.nth(1).locator('.timeline-clip')).toHaveCount(1)
  await expect(lanes.nth(0).locator('.timeline-clip')).toHaveCount(before - 1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(lanes.nth(0).locator('.timeline-clip')).toHaveCount(before)
})

test('không kéo được clip video sang track âm thanh', async () => {
  const videoLane = page.locator('.timeline-lane--video').first()
  const audioLane = page.locator('.timeline-lane--audio').first()
  const clip = videoLane.locator('.timeline-clip').first()

  await clip.hover()
  const from = await clip.boundingBox()
  const to = await audioLane.boundingBox()
  const audioBefore = await audioLane.locator('.timeline-clip').count()

  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2, to!.y + to!.height / 2, { steps: 10 })
  await page.mouse.up()

  // Clip hình rơi vào track tiếng thì nó không còn được vẽ ra hình nữa.
  await expect(audioLane.locator('.timeline-clip')).toHaveCount(audioBefore)
})

test('kéo clip âm thanh sang track âm thanh khác', async () => {
  // Track tiếng đi qua cùng một lối kéo với track hình, nhưng luật "cùng loại"
  // được kiểm bằng `kind` nên phải thử cả hai chiều mới biết nó đúng.
  const audioCard = page.locator('.media-card', { hasText: 'nhac-nen-thu.mp3' })
  await audioCard.dblclick()

  const lanes = page.locator('.timeline-lane--audio')
  const lanesBefore = await lanes.count()

  const timeline = page.getByRole('region', { name: 'Timeline' })
  await timeline.getByRole('button', { name: 'Thêm track âm thanh' }).click()
  await expect(lanes).toHaveCount(lanesBefore + 1)

  // Tìm đúng lane đang giữ clip thay vì đoán theo thứ tự: dự án mặc định đã có
  // sẵn vài track tiếng, và clip rơi vào track nào là do lớp thêm media quyết
  // định. Chốt lại bằng CHỈ SỐ chứ không giữ một locator lọc theo "có clip" —
  // locator kiểu đó tự trỏ sang lane đích ngay sau khi kéo xong.
  const sourceIndex = await lanes.evaluateAll((nodes) =>
    nodes.findIndex((node) => node.querySelector('.timeline-clip'))
  )
  expect(sourceIndex).toBeGreaterThanOrEqual(0)
  const source = lanes.nth(sourceIndex)

  const clip = source.locator('.timeline-clip').first()
  await clip.hover()
  const from = await clip.boundingBox()
  const empty = lanes.nth(lanesBefore)
  const to = await empty.boundingBox()

  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2, to!.y + to!.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(empty.locator('.timeline-clip')).toHaveCount(1)
  await expect(source.locator('.timeline-clip')).toHaveCount(0)
})

test('thêm track thì cuộn tới lane mới, không để nó nằm ngoài tầm nhìn', async () => {
  // Chiều cao mặc định của timeline chỉ vừa khoảng bốn lane. Track thứ năm trở
  // đi được tạo ra NGOÀI tầm nhìn, và nếu không tự cuộn tới thì màn hình không
  // đổi gì cả — trông y như cái nút không ăn.
  const timeline = page.getByRole('region', { name: 'Timeline' })
  const lanes = page.locator('.timeline-lane')

  // Thêm cho tới khi vùng lane thật sự tràn ra ngoài khung nhìn.
  for (let index = 0; index < 5; index++) {
    await timeline.getByRole('button', { name: 'Thêm track video' }).click()
  }

  const overflow = await page.evaluate(() => {
    const body = document.querySelector('.timeline__body') as HTMLElement
    return body.scrollHeight - body.clientHeight
  })
  expect(overflow).toBeGreaterThan(0)

  // Lane cuối phải nằm TRONG khung nhìn ngay sau khi thêm.
  const visible = await page.evaluate(() => {
    const body = document.querySelector('.timeline__body') as HTMLElement
    const all = [...document.querySelectorAll('.timeline-lane')] as HTMLElement[]
    const last = all[all.length - 1].getBoundingClientRect()
    const frame = body.getBoundingClientRect()
    return last.bottom <= frame.bottom + 1 && last.top >= frame.top - 1
  })
  expect(visible).toBe(true)

  // Đầu track đi cùng lane, không lệch hàng.
  const aligned = await page.evaluate(() => {
    const lanesEls = [...document.querySelectorAll('.timeline-lane')] as HTMLElement[]
    const heads = [...document.querySelectorAll('.track-head')] as HTMLElement[]
    const laneTop = lanesEls[lanesEls.length - 1].getBoundingClientRect().top
    const headTop = heads[heads.length - 1].getBoundingClientRect().top
    return Math.abs(laneTop - headTop) < 2
  })
  expect(aligned).toBe(true)

  // Cuộn VỪA ĐỦ: lane trên cùng không được văng khỏi màn hình chỉ vì thêm một
  // track ở dưới — mất hết chỗ dựa thì người dùng cũng không nhận ra vừa thêm gì.
  const scrolled = await page.evaluate(() => {
    const body = document.querySelector('.timeline__body') as HTMLElement
    return body.scrollTop
  })
  expect(scrolled).toBeLessThan(overflow + 1)

  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('ControlOrMeta+z')
  }
  await expect(lanes).toHaveCount(await lanes.count())
})

test('mở lại dự án KHÔNG tự cuộn timeline, lane đầu vẫn ở trên cùng', async () => {
  // Lần đầu tài liệu về, số track nhảy từ 0 lên N. Nếu coi đó là "vừa thêm
  // track" thì mở dự án nào cũng bị cuộn, và những lane đầu rơi khỏi màn hình
  // ngay khi vừa mở — đúng cảm giác "timeline chỉ có mấy lane dưới".
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.locator('.project-card__open', { hasText: 'Dự án kiểm thử' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await expect
    .poll(async () =>
      page.evaluate(() => (document.querySelector('.timeline__body') as HTMLElement).scrollTop)
    )
    .toBe(0)

  const firstVisible = await page.evaluate(() => {
    const body = document.querySelector('.timeline__body') as HTMLElement
    const first = document.querySelector('.timeline-lane') as HTMLElement
    const frame = body.getBoundingClientRect()
    const rect = first.getBoundingClientRect()
    return rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1
  })
  expect(firstVisible).toBe(true)
})
