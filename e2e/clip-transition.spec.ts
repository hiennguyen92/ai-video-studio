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

test('Inspector chỉ hiện chuyển cảnh cho clip hình, mặc định là cắt thẳng', async () => {
  await page.locator('.timeline-clip').nth(1).click()

  const select = inspector().getByLabel('Chuyển cảnh', { exact: true })
  await expect(select).toBeVisible()
  await expect(select).toHaveValue('')
  await expect(inspector().getByText(/lấy phần nguồn nằm trước điểm vào/)).toBeVisible()
})

test('đặt chuyển cảnh KHÔNG làm đổi vị trí hay độ dài clip', async () => {
  // Chờ autosave ghi xong TRƯỚC khi chụp mốc, nếu không mốc sẽ là mảng rỗng và
  // phép so sánh trở nên vô nghĩa.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const before = await savedClips()
  expect(before).toHaveLength(2)

  await inspector().getByLabel('Chuyển cảnh', { exact: true }).selectOption('fade')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  // Đây là khác biệt cốt lõi so với `xfade`: chuyển cảnh nằm gọn trong phần
  // nguồn của clip, không co timeline, không đẩy gì phía sau.
  expect(await savedClips()).toEqual(before)
})

test('giữ NGUYÊN vị trí phát, đổi hiệu ứng thì hình đổi theo', async () => {
  const stage = page.locator('.preview__stage')
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()

  await page.locator('.timeline-clip').nth(1).click()
  const select = inspector().getByLabel('Chuyển cảnh', { exact: true })

  // Chuyển cảnh dài 3 giây để vùng hiệu ứng đủ rộng mà đặt đầu phát vào giữa.
  await select.selectOption('fade')
  await inspector().getByLabel('Thời lượng (giây)').fill('3')
  await page.waitForTimeout(400)

  // Đặt đầu phát MỘT LẦN rồi giữ nguyên. Đổi vị trí giữa các lần chụp thì hình
  // khác nhau dù có hiệu ứng hay không — phép thử sẽ không chứng minh được gì.
  // Cắt ở giây 5, hiệu ứng dài 3 giây → vùng chuyển cảnh là giây 2–5. Đặt đầu
  // phát vào khoảng giữa đó, MỘT LẦN, rồi giữ nguyên.
  await page.mouse.click(box!.x + 210, box!.y + 12)
  await page.waitForTimeout(900)
  const withFade = await stage.screenshot()

  await select.selectOption('wipe-left')
  await page.waitForTimeout(900)
  const withWipe = await stage.screenshot()

  await select.selectOption('')
  await page.waitForTimeout(900)
  const withoutTransition = await stage.screenshot()

  // Cùng một thời điểm, ba trạng thái phải cho ba khung hình khác nhau.
  expect(withFade.equals(withWipe)).toBe(false)
  expect(withFade.equals(withoutTransition)).toBe(false)
  expect(withWipe.equals(withoutTransition)).toBe(false)
})

test('mỗi kiểu chuyển cảnh cho ra một khung hình riêng, không kiểu nào trùng kiểu nào', async () => {
  const stage = page.locator('.preview__stage')
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()

  await page.locator('.timeline-clip').nth(1).click()
  const select = inspector().getByLabel('Chuyển cảnh', { exact: true })
  await select.selectOption('fade')
  await inspector().getByLabel('Thời lượng (giây)').fill('3')
  await page.waitForTimeout(400)

  // Đặt đầu phát MỘT LẦN vào giữa vùng chuyển cảnh rồi giữ nguyên.
  await page.mouse.click(box!.x + 210, box!.y + 12)
  await page.waitForTimeout(900)

  const shots = new Map<string, string>()
  for (const kind of [
    'fade',
    'slide-left',
    'wipe-left',
    'zoom',
    'whip-left',
    'whip-right',
    'blur',
    'glitch',
    'spin',
    'flash'
  ]) {
    await select.selectOption(kind)
    await page.waitForTimeout(900)
    shots.set(kind, (await stage.screenshot()).toString('base64'))
  }

  // Hai kiểu cho ra cùng một ảnh nghĩa là một trong hai chưa được vẽ, và ô chọn
  // đang bày ra một lựa chọn không tồn tại.
  const seen = new Map<string, string>()
  for (const [kind, image] of shots) {
    const twin = seen.get(image)
    expect(twin, `"${kind}" vẽ ra y hệt "${twin}"`).toBeUndefined()
    seen.set(image, kind)
  }
})

test('báo rõ khi thời lượng bị kẹp vì thiếu phần nguồn phía trước', async () => {
  await page.locator('.timeline-clip').nth(1).click()
  await inspector().getByLabel('Chuyển cảnh', { exact: true }).selectOption('fade')

  // Clip sau có 5 giây handle nên 3 giây vẫn thoải mái. Kiểm ở clip ĐẦU, nơi
  // nằm ngay mốc 0 và không có gì phía trước để lấy.
  await page.locator('.timeline-clip').first().click()
  await inspector().getByLabel('Chuyển cảnh', { exact: true }).selectOption('fade')

  await expect(inspector().getByText(/Chỉ dùng được 0\.00s/)).toBeVisible()
})

test('gỡ chuyển cảnh đưa về cắt thẳng', async () => {
  await page.locator('.timeline-clip').nth(1).click()
  const select = inspector().getByLabel('Chuyển cảnh', { exact: true })
  await select.selectOption('')
  await expect(select).toHaveValue('')

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const raw = await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  const document = JSON.parse(raw) as {
    tracks: Array<{ clips: Array<{ transitionIn?: unknown }> }>
  }
  const clips = document.tracks.flatMap((track) => track.clips)
  expect(clips[1].transitionIn).toBeUndefined()
})
