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
 * Đặt keyframe bằng nút kim cương trong panel Thuộc tính.
 *
 * Kiểm bằng THAO TÁC thật rồi đọc lại file dự án: nút sáng lên là chuyện của
 * giao diện, còn thứ cần chứng minh là keyframe có vào tài liệu và có mang đúng
 * mốc thời gian tính từ mép clip hay không.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-kf-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-kf-work-'))
  const mediaPath = join(workDir, 'nguon.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:size=320x180:rate=30:duration=8',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    mediaPath
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, media) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [media] })
  }, mediaPath)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án keyframe')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const inspector = (): ReturnType<Page['getByRole']> =>
  page.getByRole('region', { name: 'Thuộc tính' })

const opacityDiamond = (): ReturnType<Page['locator']> =>
  inspector().getByRole('button', { name: /Độ mờ/ })

/**
 * Đặt đầu phát vào một phần của CLIP, không phải một phần của thước.
 *
 * Thước dài hơn clip mười giây (chỗ trống để kéo thả), nên bấm theo tỉ lệ của
 * thước sẽ rơi ra ngoài clip lúc nào không biết — và mọi thứ ở đây đều đo theo
 * mép clip.
 */
async function seekInClip(ratio: number): Promise<void> {
  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  const clip = (await page.locator('.timeline-clip').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width * ratio, ruler.y + 12)
  await page.waitForTimeout(400)
}

/** Đặt đầu phát ra ngoài mép phải của clip. */
async function seekAfterClip(): Promise<void> {
  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  const clip = (await page.locator('.timeline-clip').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width + 40, ruler.y + 12)
  await page.waitForTimeout(400)
}

/** Keyframe đã lưu trong file dự án của clip đầu tiên. */
async function savedKeyframes(): Promise<Record<string, Array<{ atUs: number; v: number }>>> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    tracks: Array<{ kind: string; clips: Array<{ keyframes?: Record<string, never> }> }>
  }
  const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
  return (clip.keyframes ?? {}) as Record<string, Array<{ atUs: number; v: number }>>
}

test('nút kim cương chỉ mọc ở ô animate được', async () => {
  await page.locator('.timeline-clip').first().click()
  await inspector().getByRole('tab', { name: 'Video', exact: true }).click()

  // Bốn ô transform đều có nút.
  for (const name of ['Độ mờ', 'Phóng to', 'Vị trí X', 'Vị trí Y']) {
    await expect(inspector().getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
  // Chưa đặt gì thì nút ở trạng thái trống.
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'none')
})

test('bấm kim cương chốt giá trị hiện tại thành keyframe tại đầu phát', async () => {
  await seekInClip(0.25)
  await page.locator('.timeline-clip').first().click()
  await opacityDiamond().click()

  // Nút chuyển sang "đang đứng trên một keyframe".
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'on')

  const keyframes = await savedKeyframes()
  expect(Object.keys(keyframes)).toEqual(['transform.opacity'])
  expect(keyframes['transform.opacity']).toHaveLength(1)
  // Mốc tính từ MÉP CLIP. Clip nằm ở đầu timeline nên mốc phải > 0 và nằm trong
  // độ dài clip — con số chính xác phụ thuộc chỗ bấm trên thước.
  expect(keyframes['transform.opacity'][0].atUs).toBeGreaterThan(0)
  expect(keyframes['transform.opacity'][0].v).toBe(1)
})

test('tua đi chỗ khác rồi kéo thanh thì sinh keyframe thứ hai, không ghi đè giá trị tĩnh', async () => {
  await seekInClip(0.6)
  // Đầu phát không còn đứng trên keyframe cũ.
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'off')

  await inspector().getByLabel('Độ mờ', { exact: true }).fill('0.3')
  await expect
    .poll(async () => (await savedKeyframes())['transform.opacity']?.length)
    .toBeGreaterThan(1)

  const keyframes = await savedKeyframes()
  const values = keyframes['transform.opacity'].map((frame) => frame.v)
  expect(values).toContain(1)
  expect(values.some((value) => Math.abs(value - 0.3) < 0.001)).toBe(true)
  // Mốc phải sắp tăng dần — bất biến mà phần đánh giá dựa vào.
  const marks = keyframes['transform.opacity'].map((frame) => frame.atUs)
  expect([...marks].sort((left, right) => left - right)).toEqual(marks)
})

test('bấm lại khi đang đứng trên keyframe thì xoá nó', async () => {
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'on')
  await opacityDiamond().click()
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'off')

  await expect.poll(async () => (await savedKeyframes())['transform.opacity']?.length).toBe(1)
})

test('xoá nốt keyframe cuối thì trường keyframes biến mất khỏi dự án', async () => {
  await seekInClip(0.25)
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'on')
  await opacityDiamond().click()

  await expect.poll(async () => Object.keys(await savedKeyframes()).length).toBe(0)
  await expect(opacityDiamond()).toHaveAttribute('data-state', 'none')
})

test('đầu phát ra ngoài clip thì nút tắt', async () => {
  await seekAfterClip()
  await expect(opacityDiamond()).toBeDisabled()
  await expect(opacityDiamond()).toHaveAttribute('title', /đầu phát vào trong clip/i)
})

test('thông số effect kiểu số có nút, ô màu và ô chọn thì không', async () => {
  await seekInClip(0.25)
  await page.locator('.timeline-clip').first().click()
  await inspector().getByRole('tab', { name: 'Video', exact: true }).click()

  // `duotone` có cường độ (số) và hai ô MÀU — đúng cặp để so trong một chỗ.
  const studio = page.getByRole('region', { name: 'AI Studio' })
  await studio.getByRole('tab', { name: 'Library' }).click()
  await studio.getByRole('tab', { name: 'Effects', exact: true }).click()
  await studio.locator('.library-panel__section:not([hidden]) [data-effect-kind="duotone"]').click()

  await expect(inspector().getByRole('button', { name: /Cường độ/ })).toBeVisible()
  // Ô màu vẫn hiện, nhưng KHÔNG có nút kim cương cạnh nó: một nút không làm gì
  // được thì tệ hơn là không có nút.
  const colorRow = inspector().locator('.field-row', { has: page.locator('input[type="color"]') })
  await expect(colorRow.first()).toBeVisible()
  await expect(colorRow.first().locator('.keyframe-diamond')).toHaveCount(0)
})
