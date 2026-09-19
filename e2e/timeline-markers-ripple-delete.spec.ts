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
 * Marker và ripple delete, chạy thật trong app bằng chuột và phím.
 *
 * Kết quả đọc từ file dự án đã lưu và từ clipboard hệ thống — một marker hiện
 * trên thước mà không vào tài liệu, hay danh sách chương không tới được clipboard,
 * thì nhìn giao diện không phát hiện ra.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-marker-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-marker-work-'))
  const video = join(workDir, 'canh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=8',
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
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, video)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án marker')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(clipLocator(0)).toBeVisible()

  // Ba clip 8 giây nằm sát nhau: 0, 8, 16 s.
  await clipLocator(0).click()
  await page.keyboard.press('Meta+d')
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)
  await clipLocator(1).click()
  await page.keyboard.press('Meta+d')
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(3)
  await page.getByRole('button', { name: 'Vừa khung' }).click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

interface SavedDocument {
  tracks: Array<{ kind: string; clips: Array<{ id: string; startUs: number }> }>
  markers: Array<{ id: string; atUs: number; label: string; color: string }>
}

async function saved(): Promise<SavedDocument> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as SavedDocument
}

async function videoStarts(): Promise<number[]> {
  const document = await saved()
  return document.tracks
    .find((track) => track.kind === 'video')!
    .clips.map((clip) => clip.startUs)
    .sort((a, b) => a - b)
}

const clipLocator = (index: number): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').nth(index)
const markerLocator = (index: number): ReturnType<Page['locator']> =>
  page.locator('.timeline-marker').nth(index)
const timecode = (): ReturnType<Page['locator']> => page.locator('.preview__timecode')

test('M đặt marker tại đầu phát, Shift+M / Cmd+Shift+M nhảy qua lại giữa các marker', async () => {
  await page.keyboard.press('Home')
  await page.keyboard.press('m')
  // 15 lần × 10 khung ở 30 fps = đúng 5 giây.
  for (let step = 0; step < 15; step += 1) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('m')
  // Bấm M lần nữa tại cùng chỗ thì không sinh marker chồng khít.
  await page.keyboard.press('m')

  await expect(page.locator('.timeline-marker')).toHaveCount(2)
  expect((await saved()).markers.map((marker) => marker.atUs).sort((a, b) => a - b)).toEqual([
    0, 5_000_000
  ])

  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+M')
  await expect(timecode()).toContainText('00:00:05:00')
  await page.keyboard.press('Meta+Shift+M')
  await expect(timecode()).toContainText('00:00:00:00')
})

test('nháy đúp marker để đặt tên, kéo cờ để dời marker', async () => {
  await markerLocator(1).dblclick()
  const dialog = page.getByRole('dialog', { name: 'Marker' })
  await dialog.getByRole('textbox', { name: 'Tên marker' }).fill('Phần chính')
  await dialog.getByRole('radio', { name: 'red' }).click()
  await dialog.getByRole('textbox', { name: 'Tên marker' }).press('Enter')
  await expect(dialog).toHaveCount(0)

  const renamed = (await saved()).markers.find((marker) => marker.atUs === 5_000_000)
  expect(renamed).toMatchObject({ label: 'Phần chính', color: 'red' })
  await expect(markerLocator(1)).toContainText('Phần chính')

  const box = (await markerLocator(1).boundingBox())!
  await page.mouse.move(box.x + 3, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + 63, box.y + 4, { steps: 10 })
  await page.mouse.up()

  const moved = (await saved()).markers.find((marker) => marker.label === 'Phần chính')
  expect(moved!.atUs).toBeGreaterThan(5_000_000)
})

test('Chép chương đưa danh sách dạng YouTube vào clipboard', async () => {
  await page.getByRole('button', { name: 'Chép chương' }).click()
  await expect(page.getByRole('button', { name: 'Đã chép chương' })).toBeVisible()
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(text).toMatch(/^0:00 Chương 1\n0:0\d Phần chính$/)
})

test('Shift+Delete và nút ripple delete xoá clip rồi dồn clip sau lên, marker đứng yên', async () => {
  expect(await videoStarts()).toEqual([0, 8_000_000, 16_000_000])
  const markersBefore = (await saved()).markers

  await clipLocator(1).click({ position: { x: 40, y: 20 } })
  await page.keyboard.press('Shift+Backspace')
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)
  expect(await videoStarts()).toEqual([0, 8_000_000])

  await clipLocator(0).click({ position: { x: 40, y: 20 } })
  await page.getByRole('button', { name: /^Ripple delete/ }).click()
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(1)
  expect(await videoStarts()).toEqual([0])

  // Ripple trên MỘT track không được kéo marker của cả video đi theo.
  expect((await saved()).markers).toEqual(markersBefore)
})
