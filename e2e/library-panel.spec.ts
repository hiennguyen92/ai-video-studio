import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
 * Tab Library: chuyển cảnh và zoom áp được vào clip bằng HAI cách — bấm thẻ khi
 * đã chọn clip, và kéo thẻ thả lên clip — và cả hai phải ghi đúng vào dự án.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-library-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-library-work-'))
  const video = join(workDir, 'canh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=6',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    video
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  outputPath = join(workDir, 'ket-qua.mp4')
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.video] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { video, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án Library')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
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

interface SavedClip {
  transitionIn?: { kind: string; durationUs: number }
  transitionOut?: { kind: string; durationUs: number }
  motion?: { kind: string; intensity: number }
  look?: { id: string; intensity: number }
}

/** Clip hình đầu tiên, đọc từ chính file dự án đã lưu. */
async function savedClip(): Promise<SavedClip> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { tracks: Array<{ kind: string; clips: SavedClip[] }> }
  return document.tracks.find((track) => track.kind === 'video')!.clips[0]
}

test('tab Library nằm cạnh Media, với bốn tab con', async () => {
  const tabs = studio().getByRole('tab')
  await expect(tabs.nth(0)).toHaveText('Media')
  await expect(tabs.nth(1)).toHaveText('Library')

  await studio().getByRole('tab', { name: 'Library' }).click()
  for (const name of ['Transitions', 'Effects', 'Filters', 'Zoom', 'Sound Effects']) {
    await expect(studio().getByRole('tab', { name, exact: true })).toBeVisible()
  }
  // Sound Effects đã chuyển hẳn sang đây: tab Nhạc nền không còn tab con nào.
  await studio().getByRole('tab', { name: 'Nhạc nền' }).click()
  await expect(studio().getByRole('tab', { name: 'Hiệu ứng', exact: true })).toHaveCount(0)
  await expect(page.locator('.sound-effect-item')).toHaveCount(0)
  await studio().getByRole('tab', { name: 'Library' }).click()
})

test('mỗi thẻ có hình minh hoạ, và nó chuyển động khi rê chuột', async () => {
  const cards = studio().locator('.library-card')
  await expect(cards).toHaveCount(14)
  await expect(studio().locator('.library-card .library-preview')).toHaveCount(14)

  // Cảnh B của chuyển cảnh: đứng yên thì style không đổi, rê chuột thì đổi theo thời gian.
  const incoming = studio()
    .getByRole('button', { name: 'Mờ chồng' })
    .locator('.library-preview__scene--b')
  const opacityOf = async (): Promise<string> => incoming.evaluate((node) => node.style.opacity)

  const resting = await opacityOf()
  await page.waitForTimeout(300)
  expect(await opacityOf()).toBe(resting)

  await studio().getByRole('button', { name: 'Mờ chồng' }).hover()
  const seen = new Set<string>()
  for (let i = 0; i < 12; i++) {
    seen.add(await opacityOf())
    await page.waitForTimeout(150)
  }
  // Một vòng mờ chồng đi qua nhiều mức độ mờ khác nhau.
  expect(seen.size).toBeGreaterThan(3)

  // Rời chuột thì về lại khung đứng yên.
  await page.mouse.move(0, 0)
  await expect.poll(opacityOf).toBe(resting)
})

test('thẻ chuyển cảnh không áp lên clip khi bấm — nó chỉ thả vào chỗ nối', async () => {
  await expect(studio().getByText(/Kéo thẻ thả vào chỗ nối giữa hai clip/)).toBeVisible()

  await page.locator('.timeline-clip').first().click()
  await studio().getByRole('button', { name: 'Lia vụt sang trái' }).click()
  await page.waitForTimeout(500)
  const clip = await savedClip()
  expect(clip.transitionIn).toBeUndefined()
  expect(clip.transitionOut).toBeUndefined()
})

test('tab Zoom áp chuyển động vào clip đang chọn', async () => {
  await studio().getByRole('tab', { name: 'Zoom', exact: true }).click()
  await studio().getByRole('button', { name: 'Rung nhẹ' }).click()
  expect((await savedClip()).motion?.kind).toBe('shake')
})

test('kéo thẻ zoom thả lên clip', async () => {
  await studio().getByRole('tab', { name: 'Zoom', exact: true }).click()
  await studio()
    .getByRole('button', { name: 'Đẩy vào chậm' })
    .dragTo(page.locator('.timeline-clip').first())
  expect((await savedClip()).motion?.kind).toBe('zoom-in')
})

test('tab Filters: 16 look minh hoạ bằng cảnh vẽ sẵn, bấm thẻ áp vào clip đang chọn', async () => {
  await studio().getByRole('tab', { name: 'Filters', exact: true }).click()
  // Chỉ tab con đang hiện: các tab đã mở vẫn nằm trong trang, chỉ bị ẩn.
  const lut = studio().locator('.library-panel__section:not([hidden])')
  const cards = lut.locator('.library-card')
  await expect(cards).toHaveCount(16)
  // Minh hoạ là cảnh vẽ sẵn như thẻ Transitions/Zoom, không phải ảnh của dự án.
  await expect(lut.locator('.library-preview__scene--a')).toHaveCount(16)
  await expect(lut.locator('img')).toHaveCount(0)
  await expect(lut.locator('.library-preview__scene--a').first()).toHaveCSS(
    'filter',
    /url\("?#look-slog3-to-709-100"?\)/
  )

  const stage = page.locator('.preview__stage')
  await page.locator('.timeline-clip').first().click()
  await page.waitForTimeout(500)
  const before = await stage.screenshot()

  await studio().getByRole('button', { name: 'Phim đen trắng', exact: true }).click()
  await expect(
    studio().getByRole('button', { name: 'Phim đen trắng', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  expect((await savedClip()).look).toEqual({ id: 'mono-film', intensity: 1 })
  await page.waitForTimeout(700)
  // Look phải tới được hình trên preview, không chỉ nằm trong dự án.
  expect((await stage.screenshot()).equals(before)).toBe(false)
})

test('Inspector chỉnh được cường độ look, đổi look giữ cường độ', async () => {
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await inspector.getByRole('tab', { name: 'Video', exact: true }).click()
  await expect(inspector.getByLabel('Filters', { exact: true })).toHaveValue('mono-film')
  await inspector.getByLabel('Cường độ filter').fill('50')
  expect((await savedClip()).look).toEqual({ id: 'mono-film', intensity: 0.5 })

  await studio().getByRole('button', { name: 'Xanh két – cam', exact: true }).click()
  expect((await savedClip()).look).toEqual({ id: 'teal-orange', intensity: 0.5 })
  await inspector.getByLabel('Cường độ filter').fill('100')
})

test('kéo thẻ LUT thả lên clip thì áp look', async () => {
  await studio()
    .getByRole('button', { name: 'Phim đen trắng', exact: true })
    .dragTo(page.locator('.timeline-clip').first())
  expect((await savedClip()).look?.id).toBe('mono-film')
})

test('look đi tới file xuất ra: đen trắng thì khung hình mất màu', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  // Look không vẽ được bằng ffmpeg: app phải tự chọn Remotion, không để look rơi mất.
  await expect(dialog.locator('.notice--info')).toContainText('Remotion')
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).first().click()
  await expect(dialog).toHaveCount(0)

  // Nguồn testsrc2 đầy màu. Rút một khung, đo độ bão hoà trung bình: gần 0 nghĩa
  // là look đen trắng thật sự nằm trong file.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stderr } = await execFileAsync(
    String(ffmpegStatic),
    [
      '-hide_banner',
      '-ss',
      '2',
      '-i',
      outputPath,
      '-frames:v',
      '1',
      '-vf',
      'signalstats,metadata=print',
      '-f',
      'null',
      '-'
    ],
    { encoding: 'utf8' }
  ).catch((error: { stderr: string }) => ({ stderr: error.stderr }))
  const saturation = Number(/lavfi\.signalstats\.SATAVG=([\d.]+)/.exec(stderr)?.[1])
  expect(saturation).toBeLessThan(3)
})

test('thanh tab con bám mép trên khi cuộn danh sách dài', async () => {
  await studio().getByRole('tab', { name: 'Sound Effects' }).click()
  await expect(page.locator('.sound-effect-item').first()).toBeVisible()

  const body = studio().locator('.panel__body')
  const bar = studio().locator('.library-panel__subtabs')
  const bodyTop = (await body.boundingBox())!.y

  // Cuộn tới cuối danh sách: bốn chục hiệu ứng dài hơn hẳn panel.
  await body.evaluate((node) => node.scrollTo({ top: node.scrollHeight }))
  await expect.poll(async () => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(200)

  // Thanh vẫn nằm sát mép trên vùng cuộn, và vẫn bấm được để đổi tab con.
  await expect.poll(async () => Math.abs((await bar.boundingBox())!.y - bodyTop)).toBeLessThan(2)
  await studio().getByRole('tab', { name: 'Zoom', exact: true }).click()
  await expect(studio().getByRole('tab', { name: 'Zoom', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
  await body.evaluate((node) => node.scrollTo({ top: 0 }))
})

test('Effects có lưới thẻ, Filters nằm ngay sau nó, Sound Effects có đủ danh sách', async () => {
  await studio().getByRole('tab', { name: 'Effects', exact: true }).click()
  await expect(studio().locator('.library-panel__section:not([hidden]) .library-card')).toHaveCount(
    30
  )

  // Filters nằm ngay sau Effects.
  const tabNames = await studio().locator('.subtab').allTextContents()
  expect(tabNames.indexOf('Filters')).toBe(tabNames.indexOf('Effects') + 1)

  await studio().getByRole('tab', { name: 'Sound Effects' }).click()
  await expect(page.locator('.sound-effect-item').first()).toBeVisible()
})
