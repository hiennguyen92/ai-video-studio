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
 * Chuyển cảnh, chạy thật trong app.
 *
 * Điều cần chứng minh:
 *
 *   1. hiệu ứng ĐỔI HÌNH thật (so ảnh chụp giữa chuyển cảnh, không tin vào state)
 *   2. timeline KHÔNG bị co — khác hẳn `xfade` của ffmpeg
 *   3. giao diện nói ra khi thời lượng bị kẹp vì thiếu phần nguồn phía trước
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
let secondMediaPath: string

test.describe.configure({ mode: 'serial' })

async function savedClips(): Promise<Array<{ startUs: number; durationUs: number }>> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { tracks: Array<{ clips: Array<{ startUs: number; durationUs: number }> }> }
  // Chỉ lấy vị trí và độ dài: so cả object sẽ khác nhau vì chính trường
  // `transitionIn` vừa được đặt, mà đó không phải thứ phép thử này nói tới.
  return document.tracks
    .flatMap((track) => track.clips)
    .map((clip) => ({ startUs: clip.startUs, durationUs: clip.durationUs }))
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-trans-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-trans-work-'))
  mediaPath = join(workDir, 'do.mp4')
  secondMediaPath = join(workDir, 'xanh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  // Hai nguồn MÀU KHÁC HẲN nhau, và mỗi nguồn có HOẠ TIẾT. Hai điều kiện, hai lý do:
  //
  //   - khác màu: cắt đôi một clip rồi đặt chuyển cảnh thì clip sau bị kéo lùi
  //     nguồn và hiện đúng khung hình giống clip trước; trộn hai ảnh giống nhau
  //     nhìn không khác gì
  //   - có hoạ tiết: trên màu trơn, trượt vào và xén lộ dần cho ra ẢNH Y HỆT —
  //     cùng một đường biên, cùng hai mảng màu. Đo thật: `wipe-left` và
  //     `slide-left` trùng khít nhau cho tới khi thêm lưới
  for (const [path, color] of [
    [mediaPath, 'red'],
    [secondMediaPath, 'blue']
  ]) {
    await execFileAsync(String(ffmpegStatic), [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=640x360:rate=30:duration=20`,
      '-vf',
      'drawgrid=w=48:h=48:t=4:color=white',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      path
    ])
  }

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
    },
    [mediaPath, secondMediaPath]
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chuyển cảnh')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 90_000 })

  // Ghi bố cục thẳng vào file dự án: clip sau phải có `sourceInUs` > 0 thì chuyển
  // cảnh mới có phần nguồn phía trước để dùng, mà kéo mép clip trong e2e thì rất
  // mong manh.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()

  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')
  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    assets: Array<{ id: string; name: string }>
    tracks: Array<{ kind: string; clips: unknown[] }>
    revision: number
  }
  const red = document.assets.find((asset) => asset.name.startsWith('do'))!
  const blue = document.assets.find((asset) => asset.name.startsWith('xanh'))!
  const videoTrack = document.tracks.find((track) => track.kind === 'video')!

  const base = { speed: 1, volume: 1, fadeInUs: 0, fadeOutUs: 0 }
  videoTrack.clips = [
    { id: 'clip_do', assetId: red.id, startUs: 0, durationUs: 5_000_000, sourceInUs: 0, ...base },
    {
      id: 'clip_xanh',
      assetId: blue.id,
      startUs: 5_000_000,
      durationUs: 5_000_000,
      // 5 giây handle: thừa cho chuyển cảnh 3 giây.
      sourceInUs: 5_000_000,
      ...base
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')

  await page.locator('.project-card__open', { hasText: 'Dự án chuyển cảnh' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const inspector = (): ReturnType<Page['getByRole']> =>
  page.getByRole('region', { name: 'Thuộc tính' })
const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

interface SavedTransitionClip {
  id: string
  transitionIn?: { kind: string; durationUs: number }
  transitionOut?: { kind: string; durationUs: number }
}

async function savedVideoClips(): Promise<SavedTransitionClip[]> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { tracks: Array<{ kind: string; clips: SavedTransitionClip[] }> }
  return document.tracks.find((track) => track.kind === 'video')!.clips
}

/**
 * Kéo một thẻ chuyển cảnh từ tab Library thả vào chỗ nối giữa hai clip.
 * `offsetPx` lệch điểm thả khỏi chỗ nối, để thử thả trượt.
 */
async function dropOnCut(name: string, offsetPx = 0): Promise<void> {
  const lane = page.locator('.timeline-lane--video').first()
  const laneBox = (await lane.boundingBox())!
  const cutX = (await page.locator('.timeline-clip').nth(1).boundingBox())!.x
  await studio()
    .getByRole('button', { name, exact: true })
    .dragTo(lane, { targetPosition: { x: cutX - laneBox.x + offsetPx, y: laneBox.height / 2 } })
}

test('Inspector không còn mục chuyển cảnh trên từng clip', async () => {
  await page.locator('.timeline-clip').nth(1).click()
  await inspector().getByRole('tab', { name: 'Animation', exact: true }).click()
  // Mục chuyển động vẫn còn — dấu hiệu Inspector đã hiện đủ cho clip hình.
  await expect(inspector().getByLabel('Zoom', { exact: true })).toBeVisible()
  await expect(inspector().getByLabel('Transitions', { exact: true })).toHaveCount(0)
  await expect(inspector().getByLabel('Animation ra', { exact: true })).toHaveCount(0)

  await studio().getByRole('tab', { name: 'Library' }).click()
  await expect(studio().getByText(/Kéo thẻ thả vào chỗ nối giữa hai clip/)).toBeVisible()
})

test('thả vào chỗ nối: ra ở clip trước, vào ở clip sau, clip không xê dịch', async () => {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const before = await savedClips()
  expect(before).toHaveLength(2)

  await dropOnCut('Mờ chồng')
  const [first, second] = await savedVideoClips()
  expect(first.transitionOut?.kind).toBe('fade')
  expect(second.transitionIn?.kind).toBe('fade')
  // Clip đầu không có hiệu ứng vào, clip sau không có hiệu ứng ra: chỉ chỗ nối đổi.
  expect(first.transitionIn).toBeUndefined()
  expect(second.transitionOut).toBeUndefined()

  // Chuyển cảnh nằm gọn trong phần nguồn của clip, không co timeline, không đẩy gì.
  expect(await savedClips()).toEqual(before)

  // Chỗ nối hiện biểu tượng cho biết kiểu đang dùng.
  await expect(page.getByRole('button', { name: 'Transition: Mờ chồng' })).toBeVisible()

  // Tab Animation của clip SAU chỗ nối hiện phía "Vào"; đổi thời lượng ở đây là đổi
  // cả chỗ nối, hai phía cùng một số.
  await page.locator('.timeline-clip').nth(1).click()
  const edgeIn = inspector().locator('[data-transition-edge="in"]')
  await expect(edgeIn).toContainText('Vào: Mờ chồng')
  await expect(inspector().locator('[data-transition-edge="out"]')).toHaveCount(0)
  await edgeIn.getByLabel('Thời lượng transition (Vào)').selectOption('1000000')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const [left, right] = await savedVideoClips()
  expect(left.transitionOut?.durationUs).toBe(1_000_000)
  expect(right.transitionIn?.durationUs).toBe(1_000_000)
  await edgeIn.getByLabel('Thời lượng transition (Vào)').selectOption('500000')
})

test('mỗi kiểu thả vào chỗ nối cho ra một khung hình riêng, không kiểu nào trùng kiểu nào', async () => {
  const stage = page.locator('.preview__stage')
  const ruler = page.locator('.timeline__ruler-row')
  const rulerBox = (await ruler.boundingBox())!
  const firstBox = (await page.locator('.timeline-clip').first().boundingBox())!

  // Chuyển cảnh mặc định 0,5 giây quanh chỗ nối ở giây 5 → đặt đầu phát ở giây
  // 4,75, MỘT LẦN, rồi giữ nguyên. Đổi vị trí giữa các lần chụp thì hình khác
  // nhau dù có hiệu ứng hay không — phép thử sẽ không chứng minh được gì.
  await page.mouse.click(firstBox.x + (firstBox.width * 4.75) / 5, rulerBox.y + 12)
  await page.waitForTimeout(900)

  const shots = new Map<string, string>()
  for (const name of [
    'Mờ chồng',
    'Trượt sang trái',
    'Gạt sang trái',
    'Phóng vào',
    'Lia vụt sang trái',
    'Lia vụt sang phải',
    'Nhoè dần rồi rõ',
    'Nhiễu hình',
    'Xoay vào',
    'Loé trắng'
  ]) {
    await dropOnCut(name)
    await expect(page.getByRole('button', { name: `Transition: ${name}` })).toBeVisible()
    await page.waitForTimeout(900)
    shots.set(name, (await stage.screenshot()).toString('base64'))
  }

  // Hai kiểu cho ra cùng một ảnh nghĩa là một trong hai chưa được vẽ, và thẻ đang
  // bày ra một lựa chọn không tồn tại.
  const seen = new Map<string, string>()
  for (const [name, image] of shots) {
    const twin = seen.get(image)
    expect(twin, `"${name}" vẽ ra y hệt "${twin}"`).toBeUndefined()
    seen.set(image, name)
  }
})

test('chuột phải vào biểu tượng mở menu có tên chuyển cảnh, và chọn được thời lượng', async () => {
  // Không còn nút xoá thường trực trên timeline.
  await page.locator('.timeline-cut').first().hover()
  await expect(page.locator('.timeline-cut').getByRole('button', { name: /Xoá/ })).toHaveCount(0)

  const badge = page.locator('.timeline-cut__badge').first()
  const name = (await badge.getAttribute('aria-label'))!.replace('Transition: ', '')
  await badge.click({ button: 'right' })

  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  // Tên kiểu chuyển cảnh đang dùng nằm ngay trên đầu menu.
  await expect(menu.locator('.context-menu__title')).toHaveText(name)
  for (const label of ['0,2 giây', '0,3 giây', '0,5 giây', '1 giây', '2 giây']) {
    await expect(menu.getByRole('menuitemradio', { name: label, exact: true })).toBeVisible()
  }
  // Mặc định 0,5 giây, được đánh dấu.
  await expect(menu.getByRole('menuitemradio', { name: '0,5 giây', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )

  await menu.getByRole('menuitemradio', { name: '1 giây', exact: true }).click()
  await expect(menu).toHaveCount(0)
  const [first, second] = await savedVideoClips()
  // Cùng một con số cho cả hai phía, kiểu giữ nguyên.
  expect(first.transitionOut?.durationUs).toBe(1_000_000)
  expect(second.transitionIn?.durationUs).toBe(1_000_000)
  expect(second.transitionIn?.kind).toBe(first.transitionOut?.kind)

  // Mở lại thì mức vừa chọn được đánh dấu; Escape đóng menu mà không đổi gì.
  await badge.click({ button: 'right' })
  await expect(
    page.getByRole('menu').getByRole('menuitemradio', { name: '1 giây', exact: true })
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
})

test('xoá chuyển cảnh từ menu chuột phải gỡ cả hai phía', async () => {
  await page.locator('.timeline-cut__badge').first().click({ button: 'right' })
  await page.getByRole('menu').getByRole('menuitem', { name: 'Xoá transition' }).click()

  await expect(page.locator('.timeline-cut')).toHaveCount(0)
  const [first, second] = await savedVideoClips()
  expect(first.transitionOut).toBeUndefined()
  expect(second.transitionIn).toBeUndefined()
})

test('thả xa chỗ nối thì không đặt chuyển cảnh nào', async () => {
  const firstBox = (await page.locator('.timeline-clip').first().boundingBox())!
  // Giữa clip đầu: cách chỗ nối cả nửa clip.
  await dropOnCut('Xoay vào', -firstBox.width / 2)
  await page.waitForTimeout(500)

  await expect(page.locator('.timeline-cut')).toHaveCount(0)
  const clips = await savedVideoClips()
  expect(clips.every((clip) => !clip.transitionIn && !clip.transitionOut)).toBe(true)
})
