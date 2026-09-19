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
 * Kéo nhiều clip cùng lúc và nhóm clip, chạy thật trong app bằng chuột và phím.
 *
 * Mọi kết quả đọc từ file dự án đã lưu: điều cần chứng minh là cả loạt dời ĐÚNG
 * CÙNG một khoảng và không clip nào bị đè mất một đoạn — hai thứ mà nhìn khung
 * clip trên giao diện lúc kéo thì không phân biệt được với bản ghi thật.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-group-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-group-work-'))
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án nhóm clip')
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

  // Nhân bản: clip thứ hai nằm SÁT sau clip đầu — đúng ca mà dời từng clip một sẽ
  // để clip trước đè lên clip sau.
  await clipLocator(0).click()
  await page.keyboard.press('Meta+d')
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)
  await page.getByRole('button', { name: 'Vừa khung' }).click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

interface SavedClip {
  id: string
  startUs: number
  durationUs: number
  linkGroupId?: string
}

async function savedClips(): Promise<SavedClip[]> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { tracks: Array<{ kind: string; clips: SavedClip[] }> }
  return [...document.tracks.find((track) => track.kind === 'video')!.clips].sort(
    (a, b) => a.startUs - b.startUs
  )
}

const clipLocator = (index: number): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').nth(index)

/** Bấm vào giữa thân clip (tránh vùng kéo mép). */
async function clickClip(index: number, modifiers: Array<'Shift'> = []): Promise<void> {
  await clipLocator(index).click({ position: { x: 40, y: 20 }, modifiers })
}

/** Kéo thân clip sang ngang `dx` pixel, bước nhỏ như tay người. */
async function dragClip(index: number, dx: number): Promise<void> {
  const box = (await clipLocator(index).boundingBox())!
  const x = box.x + 40
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

test('chọn hai clip bằng Shift rồi kéo: cả hai dời cùng khoảng, không clip nào bị đè', async () => {
  const before = await savedClips()
  expect(before).toHaveLength(2)
  expect(before[1].startUs).toBe(before[0].startUs + before[0].durationUs)

  await clickClip(0)
  await clickClip(1, ['Shift'])
  await expect(page.locator('.timeline-lane--video .timeline-clip--selected')).toHaveCount(2)

  await dragClip(0, 80)

  const after = await savedClips()
  const delta = after[0].startUs - before[0].startUs
  expect(delta).toBeGreaterThan(0)
  expect(after.map((clip) => clip.startUs - delta)).toEqual(before.map((clip) => clip.startUs))
  expect(after.map((clip) => clip.durationUs)).toEqual(before.map((clip) => clip.durationUs))
})

test('Cmd+G gộp nhóm: bấm một clip là chọn cả nhóm, kéo một clip là dời cả nhóm', async () => {
  await clickClip(0)
  await clickClip(1, ['Shift'])
  await page.keyboard.press('Meta+g')

  const grouped = await savedClips()
  expect(grouped[0].linkGroupId).toBeTruthy()
  expect(grouped[1].linkGroupId).toBe(grouped[0].linkGroupId)
  await expect(page.locator('.timeline-clip__group-icon')).toHaveCount(2)

  // Bỏ chọn, rồi bấm đúng MỘT clip.
  await page.keyboard.press('Escape')
  await clickClip(1)
  await expect(page.locator('.timeline-lane--video .timeline-clip--selected')).toHaveCount(2)

  await dragClip(1, -40)
  const after = await savedClips()
  const delta = after[0].startUs - grouped[0].startUs
  expect(delta).toBeLessThan(0)
  expect(after[1].startUs - grouped[1].startUs).toBe(delta)
})

test('Cmd+Shift+G rã nhóm: kéo một clip thì chỉ clip đó dời', async () => {
  await clickClip(0)
  await page.keyboard.press('Meta+Shift+g')

  const ungrouped = await savedClips()
  expect(ungrouped.every((clip) => !clip.linkGroupId)).toBe(true)
  await expect(page.locator('.timeline-clip__group-icon')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await clickClip(1)
  await expect(page.locator('.timeline-lane--video .timeline-clip--selected')).toHaveCount(1)
  await dragClip(1, 60)

  const after = await savedClips()
  expect(after[0].startUs).toBe(ungrouped[0].startUs)
  expect(after[1].startUs).toBeGreaterThan(ungrouped[1].startUs)
})

test('hộp thoại đang mở: Delete không xoá clip nằm phía sau nó', async () => {
  await clickClip(0)
  await page.keyboard.press('Shift+?')
  const dialog = page.getByRole('dialog', { name: 'Phím tắt' })
  await expect(dialog).toBeVisible()

  await page.keyboard.press('Delete')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  // Trước đây: clip đang chọn bị xoá ngay sau lưng hộp thoại.
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)
})
