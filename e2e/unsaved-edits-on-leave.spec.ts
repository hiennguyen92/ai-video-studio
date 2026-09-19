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
 * Sửa xong rồi rời đi NGAY — không được mất sửa đổi.
 *
 * Autosave chờ 1,2 s sau lần sửa cuối rồi mới ghi. Trước đây bấm "về danh sách dự
 * án" hay đóng cửa sổ trong khoảng đó thì bộ hẹn giờ bị huỷ cùng giao diện, và
 * sửa đổi cuối cùng biến mất không một lời báo. Phép thử bấm rời đi ngay sau khi
 * sửa, không chờ chữ "Đã lưu".
 */

const execFileAsync = promisify(execFile)

let userDataDir: string
let video: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-leave-'))
  video = join(userDataDir, 'canh.mp4')
  const ffmpegPath = String((await import('ffmpeg-static')).default)
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=3',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    video
  ])
})

test.afterAll(async () => {
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, video)
  return { app, page }
}

async function savedDocument(): Promise<{
  tracks: Array<{ kind: string; clips: unknown[] }>
  markers: unknown[]
}> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8'))
}

test('về danh sách dự án ngay sau khi sửa: sửa đổi vẫn được lưu', async () => {
  const { app, page } = await launch()
  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Rời đi ngay')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(1)

  // Không chờ "Đã lưu" — đúng như người dùng bấm về ngay.
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.getByText('Rời đi ngay').waitFor()

  const document = await savedDocument()
  expect(document.tracks.find((track) => track.kind === 'video')!.clips).toHaveLength(1)

  await page.getByText('Rời đi ngay').click()
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(1)
  await app.close()
})

test('đóng cửa sổ ngay sau khi sửa: sửa đổi vẫn được lưu', async () => {
  const { app, page } = await launch()
  await page.getByText('Rời đi ngay').click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  await page.locator('.timeline__body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('m')
  await expect(page.locator('.timeline-marker')).toHaveCount(1)
  // Đóng ngay, không chờ autosave.
  await app.close()

  expect((await savedDocument()).markers).toHaveLength(1)
})
