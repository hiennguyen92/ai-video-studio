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
 * Cắt khoảng lặng và khôi phục phiên bản, chạy thật trong app.
 *
 * Footage có tiếng thật: sine 2 s – im 1,5 s – sine 2 s. Cắt khoảng lặng phải
 * gọi ffmpeg thật qua IPC; khôi phục phải đọc bản chụp thật trên đĩa. Kết quả
 * đọc từ project.json đã lưu, không chỉ nhìn giao diện.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-silence-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-silence-work-'))
  const video = join(workDir, 'canh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=5.5',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=44100:cl=mono',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=2',
    '-filter_complex',
    '[2]atrim=duration=1.5[s];[1][s][3]concat=n=3:v=0:a=1[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án khoảng lặng')
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

  await page.getByRole('button', { name: 'Vừa khung' }).click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

interface SavedDocument {
  revision: number
  tracks: Array<{ kind: string; clips: Array<{ id: string; startUs: number; durationUs: number }> }>
}

async function saved(): Promise<SavedDocument> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as SavedDocument
}

async function videoClips(): Promise<Array<{ startUs: number; durationUs: number }>> {
  return (await saved()).tracks.find((track) => track.kind === 'video')!.clips
}

const clipLocator = (index: number): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').nth(index)

test('cắt khoảng lặng: dò bằng ffmpeg, báo trước, cắt rồi dồn phần sau lên', async () => {
  await clipLocator(0).click({ position: { x: 40, y: 20 } })
  await page.getByRole('button', { name: 'Cắt khoảng lặng' }).click()

  const dialog = page.getByRole('dialog', { name: 'Cắt khoảng lặng' })
  await dialog.getByRole('button', { name: 'Dò khoảng lặng' }).click()
  await expect(dialog.getByRole('status')).toContainText('Tìm thấy 1 khoảng lặng', {
    timeout: 30_000
  })
  await dialog.getByRole('button', { name: 'Cắt', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  const clips = await videoClips()
  expect(clips).toHaveLength(2)
  // 5,5 s trừ (1,5 s im − 2 × 0,15 s chừa lại) ≈ 4,3 s.
  const total = clips.reduce((sum, clip) => sum + clip.durationUs, 0)
  expect(total).toBeGreaterThan(4_150_000)
  expect(total).toBeLessThan(4_450_000)
  // Không để khe hở: clip sau bắt đầu đúng chỗ clip trước dừng.
  expect(clips[1].startUs).toBe(clips[0].startUs + clips[0].durationUs)
})

test('lưu phiên bản, xoá hết clip, khôi phục thì clip quay lại và bản trước đó được chụp', async () => {
  const before = await videoClips()
  await page.getByRole('button', { name: 'Phiên bản' }).click()
  const dialog = page.getByRole('dialog', { name: 'Phiên bản đã lưu' })
  await dialog.getByRole('button', { name: 'Lưu phiên bản ngay' }).click()
  await expect(dialog.getByText('Đã lưu một phiên bản')).toBeVisible()
  // Autosave cũng đã chụp một bản tự động; bản lưu tay là bản mới nhất.
  const manualRow = dialog.locator('.project-versions__item', { hasText: 'Lưu tay' })
  await expect(manualRow).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  // Xoá hết clip.
  await clipLocator(0).click({ position: { x: 20, y: 20 } })
  await clipLocator(1).click({ position: { x: 20, y: 20 }, modifiers: ['Shift'] })
  await page.keyboard.press('Delete')
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(0)
  const emptied = await saved()
  expect(emptied.tracks.find((track) => track.kind === 'video')!.clips).toEqual([])

  await page.getByRole('button', { name: 'Phiên bản' }).click()
  await manualRow.getByRole('button', { name: 'Khôi phục' }).click()
  await manualRow.getByRole('button', { name: 'Bấm lần nữa để khôi phục' }).click()
  await expect(dialog).toHaveCount(0)

  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)
  const restored = await saved()
  expect(
    restored.tracks.find((track) => track.kind === 'video')!.clips.map((c) => c.durationUs)
  ).toEqual(before.map((clip) => clip.durationUs))
  // Revision đi TIẾP chứ không lùi về số của bản chụp.
  expect(restored.revision).toBeGreaterThan(emptied.revision)

  // Bản trước khi khôi phục (timeline rỗng) đã được chụp lại — đường lui khi khôi phục nhầm.
  await page.getByRole('button', { name: 'Phiên bản' }).click()
  const backupRow = dialog.locator('.project-versions__item', { hasText: 'Trước khi khôi phục' })
  await expect(backupRow).toContainText('0 clip')
})
