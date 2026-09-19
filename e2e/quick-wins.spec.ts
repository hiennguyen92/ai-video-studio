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
 * Vòng "việc nhỏ", chạy thật trong app: bảng phím tắt, đổi khung ngay từ cảnh báo
 * của mẫu xuất, ngưỡng im tự đo, đóng băng khung, và nhân bản dự án.
 *
 * Footage có tiếng trên nền nhiễu ồn (đỉnh nhiễu -30,5 dB, cao hơn -35 dB): đúng ca
 * mà ngưỡng cố định trước đây không bắt được khoảng lặng nào.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

interface SavedDocument {
  name: string
  settings: { aspectRatio: string }
  tracks: Array<{
    kind: string
    clips: Array<{ assetId: string; startUs: number; durationUs: number }>
  }>
  assets: Array<{ id: string; source: { path: string }; generated?: { task: string } }>
}

async function savedProjects(): Promise<SavedDocument[]> {
  const projectsRoot = join(userDataDir, 'projects')
  const ids = await readdir(projectsRoot)
  return Promise.all(
    ids.map(async (id) =>
      JSON.parse(await readFile(join(projectsRoot, id, 'project.json'), 'utf8'))
    )
  )
}

async function saved(): Promise<SavedDocument> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const [document] = await savedProjects()
  return document
}

const videoClips = (): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip')

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-quick-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-quick-work-'))
  const video = join(workDir, 'noi-trong-phong-on.mp4')
  const ffmpegPath = String((await import('ffmpeg-static')).default)

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='0.4*sin(2*PI*300*t)*(between(t,1,2)+between(t,3,4))':s=48000:d=5",
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=white:amplitude=0.03:sample_rate=48000:duration=5',
    '-filter_complex',
    '[1][2]amix=inputs=2:normalize=0[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án việc nhỏ')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(videoClips()).toHaveCount(1)
  await page.getByRole('button', { name: 'Vừa khung' }).click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

test('phím ? mở bảng phím tắt, Esc đóng mà không bỏ chọn clip', async () => {
  await videoClips()
    .first()
    .click({ position: { x: 30, y: 20 } })
  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Phím tắt' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Đặt marker tại đầu phát')).toBeVisible()
  await expect(dialog.getByText('Xoá clip và dồn phần sau trên cùng lane lên')).toBeVisible()
  // Phím chọn công cụ đọc từ bảng thật: có dòng Blade.
  await expect(dialog.getByText('Blade', { exact: false })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.timeline-lane--video .timeline-clip--selected')).toHaveCount(1)

  await page.getByRole('button', { name: 'Phím tắt (?)' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng' }).click()
})

test('cắt khoảng lặng tự đo ngưỡng bắt được khoảng lặng trong phòng ồn', async () => {
  await videoClips()
    .first()
    .click({ position: { x: 30, y: 20 } })
  await page.getByRole('button', { name: 'Cắt khoảng lặng' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cắt khoảng lặng' })
  await expect(dialog.getByLabel('Tự đo ngưỡng theo nền nhiễu')).toBeChecked()
  await dialog.getByRole('button', { name: 'Dò khoảng lặng' }).click()
  const status = dialog.getByRole('status')
  await expect(status).toContainText('Tìm thấy', { timeout: 30_000 })
  await expect(status).toContainText(/ngưỡng -\d+/)
  // Ô ngưỡng nhận mức tự đo, để chỉnh tay thì bắt đầu từ con số đúng.
  expect(Number(await dialog.getByLabel('Ngưỡng im (dB, đỉnh)').inputValue())).toBeGreaterThan(-30)
  await dialog.getByRole('button', { name: 'Đóng' }).click()
})

test('đóng băng khung tại đầu phát: chèn 2 giây đứng hình, phần sau dời theo', async () => {
  await page.keyboard.press('Home')
  // 3 × 10 khung ở 30 fps = đúng 1 giây.
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('Shift+ArrowRight')
  await videoClips()
    .first()
    .click({ position: { x: 30, y: 20 }, modifiers: [] })
  await page.getByRole('button', { name: 'Đứng hình 2 giây tại đầu phát' }).click()
  await expect(videoClips()).toHaveCount(3, { timeout: 60_000 })

  const document = await saved()
  const clips = document.tracks.find((track) => track.kind === 'video')!.clips
  const freezeAsset = document.assets.find((item) => item.generated?.task === 'freeze-frame')!
  const still = clips.find((clip) => clip.assetId === freezeAsset.id)!
  expect(still.durationUs).toBe(2_000_000)
  // Tổng dài hơn đúng 2 giây: 5 s gốc + 2 s đứng hình.
  expect(clips.reduce((sum, clip) => sum + clip.durationUs, 0)).toBe(7_000_000)
  expect(clips.map((clip) => clip.startUs)).toEqual([0, still.startUs, still.startUs + 2_000_000])
})

test('cảnh báo lệch khung của mẫu xuất có nút đổi khung ngay tại chỗ', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByLabel('Mẫu xuất').selectOption('vertical-short')
  await dialog.getByRole('button', { name: 'Đổi khung sang 9:16' }).click()
  await expect(dialog.getByText(/Mẫu này cần khung/)).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Đóng' }).click()
  expect((await saved()).settings.aspectRatio).toBe('9:16')
})

test('nhân bản dự án: bản sao đủ clip và có media đứng hình của riêng nó', async () => {
  await saved()
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.getByRole('button', { name: 'Nhân bản dự án "Dự án việc nhỏ"' }).click()
  await expect(page.getByText('Dự án việc nhỏ (bản sao)')).toBeVisible()

  const projects = await savedProjects()
  expect(projects).toHaveLength(2)
  const original = projects.find((item) => item.name === 'Dự án việc nhỏ')!
  const copy = projects.find((item) => item.name === 'Dự án việc nhỏ (bản sao)')!
  expect(copy.tracks.find((track) => track.kind === 'video')!.clips).toHaveLength(3)

  const originalFreeze = original.assets.find((item) => item.generated?.task === 'freeze-frame')!
  const copyFreeze = copy.assets.find((item) => item.generated?.task === 'freeze-frame')!
  expect(copyFreeze.source.path).not.toBe(originalFreeze.source.path)

  // Mở bản sao được như một dự án bình thường.
  await page.getByText('Dự án việc nhỏ (bản sao)').click()
  await expect(videoClips()).toHaveCount(3)
})
