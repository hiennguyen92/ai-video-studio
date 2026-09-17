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
 * Chế độ công cụ của timeline, chạy thật trong app: Blade cắt tại chỗ bấm, Trim kéo
 * mép thì clip sau dịch theo, Slip đổi đoạn nguồn mà giữ chỗ, Rate stretch đổi độ dài
 * bằng tốc độ, và nút kéo cắt clip đang chọn tại đầu phát. Mọi kết quả đọc từ file
 * dự án đã lưu, không chỉ nhìn giao diện.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-tools-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-tools-work-'))
  const video = join(workDir, 'canh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=20',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án công cụ')
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
  id: string
  startUs: number
  durationUs: number
  sourceInUs: number
  speed: number
}

/** Các clip trên track video, theo thứ tự thời gian, đọc từ file dự án đã lưu. */
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

const timeline = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'Timeline' })
const clipLocator = (index: number): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').nth(index)

/** Kéo chuột ngang từ một điểm, bước nhỏ như tay người. */
async function dragBy(x: number, y: number, dx: number): Promise<void> {
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y, { steps: 12 })
  await page.mouse.up()
}

test('thanh công cụ có năm chế độ, Selection bật sẵn, phím tắt đổi được chế độ', async () => {
  const tools = timeline().getByRole('radiogroup', { name: 'Chế độ công cụ' })
  await expect(tools.getByRole('radio')).toHaveCount(5)
  await expect(tools.getByRole('radio', { name: 'Selection (V)' })).toHaveAttribute(
    'aria-checked',
    'true'
  )

  await page.locator('.timeline__body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('b')
  await expect(tools.getByRole('radio', { name: 'Blade (B)' })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect(page.locator('.timeline')).toHaveClass(/timeline--tool-blade/)
  await page.keyboard.press('v')
  await expect(tools.getByRole('radio', { name: 'Selection (V)' })).toHaveAttribute(
    'aria-checked',
    'true'
  )

  // Nút kéo cắt clip đang chọn nằm ngay cạnh.
  await expect(timeline().getByRole('button', { name: 'Cắt tại playhead (S)' })).toBeVisible()
  // Thu nhỏ timeline cho cả clip 20 giây nằm gọn trong khung nhìn.
  await timeline().getByRole('button', { name: 'Thu nhỏ' }).click()
})

test('rê chuột lên nút công cụ thì hiện tooltip: tên, phím tắt, mô tả', async () => {
  await timeline().getByRole('radio', { name: 'Slip (Y)' }).hover()
  const tooltip = page.getByRole('tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('.tooltip__title')).toContainText('Slip')
  await expect(tooltip.locator('.tooltip__kbd')).toHaveText('Y')
  await expect(tooltip).toContainText('giữ nguyên vị trí và độ dài')

  // Rê sang nút kéo: tooltip đổi theo ngay, có phím tắt S.
  await timeline().getByRole('button', { name: 'Cắt tại playhead (S)' }).hover()
  await expect(tooltip.locator('.tooltip__title')).toContainText('Cắt tại playhead')
  await expect(tooltip.locator('.tooltip__kbd')).toHaveText('S')

  // Rời khỏi nút thì tooltip tắt.
  await page.mouse.move(5, 5)
  await expect(tooltip).toHaveCount(0)
})

test('Blade: bấm lên clip là cắt đôi đúng chỗ bấm', async () => {
  await timeline().getByRole('radio', { name: 'Blade (B)' }).click()
  const box = (await clipLocator(0).boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(2)

  const [first, second] = await savedClips()
  expect(Math.abs(first.durationUs - 10_000_000)).toBeLessThan(600_000)
  expect(second.startUs).toBe(first.startUs + first.durationUs)
})

test('Trim: kéo mép cuối clip đầu vào trong thì clip sau lùi lên theo, không hở', async () => {
  await timeline().getByRole('radio', { name: 'Trim (T)' }).click()
  const before = await savedClips()
  const box = (await clipLocator(0).boundingBox())!
  await dragBy(box.x + box.width - 3, box.y + box.height / 2, -60)

  const after = await savedClips()
  expect(after[0].durationUs).toBeLessThan(before[0].durationUs)
  expect(after[1].startUs).toBe(after[0].startUs + after[0].durationUs)
  // Clip sau giữ nguyên nội dung, chỉ dịch chỗ.
  expect(after[1].durationUs).toBe(before[1].durationUs)
  expect(after[1].sourceInUs).toBe(before[1].sourceInUs)
})

test('Slip: kéo clip đổi đoạn nguồn, giữ nguyên vị trí và độ dài', async () => {
  await timeline().getByRole('radio', { name: 'Slip (Y)' }).click()
  const before = await savedClips()
  const box = (await clipLocator(1).boundingBox())!
  await dragBy(box.x + box.width / 2, box.y + box.height / 2, 40)

  const after = await savedClips()
  expect(after[1].sourceInUs).toBeLessThan(before[1].sourceInUs)
  expect(after[1].startUs).toBe(before[1].startUs)
  expect(after[1].durationUs).toBe(before[1].durationUs)
})

test('Rate stretch: kéo dài mép cuối thì clip chậm lại, đoạn nguồn giữ nguyên', async () => {
  await timeline().getByRole('radio', { name: 'Rate stretch (R)' }).click()
  const before = await savedClips()
  const spanBefore = before[0].durationUs * before[0].speed
  const box = (await clipLocator(0).boundingBox())!
  await dragBy(box.x + box.width - 3, box.y + box.height / 2, 60)

  const after = await savedClips()
  expect(after[0].speed).toBeLessThan(1)
  expect(after[0].durationUs).toBeGreaterThan(before[0].durationUs)
  expect(Math.abs(after[0].durationUs * after[0].speed - spanBefore)).toBeLessThan(2000)
  expect(after[0].sourceInUs).toBe(before[0].sourceInUs)
})

test('nút kéo cắt clip đang chọn tại đầu phát', async () => {
  await timeline().getByRole('radio', { name: 'Selection (V)' }).click()
  const count = await page.locator('.timeline-lane--video .timeline-clip').count()
  const box = (await clipLocator(0).boundingBox())!
  // Đặt đầu phát vào giữa clip bằng thước, rồi chọn clip.
  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  await page.mouse.click(box.x + box.width / 2, ruler.y + 12)
  await page.mouse.click(box.x + box.width / 3, box.y + box.height / 2)
  await timeline().getByRole('button', { name: 'Cắt tại playhead (S)' }).click()
  await expect(page.locator('.timeline-lane--video .timeline-clip')).toHaveCount(count + 1)
})
