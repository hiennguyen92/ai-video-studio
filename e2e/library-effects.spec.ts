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
 * Tab Effects: thẻ minh hoạ bằng chính bộ vẽ effect, bấm/kéo để CHỒNG effect lên
 * clip, chỉnh và gỡ ở Inspector, và effect phải có mặt trong file xuất ra.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-effects-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-effects-work-'))
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án Effects')
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
  effects?: Array<{ id: string; kind: string; intensity: number; params: Record<string, unknown> }>
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

test('tab Effects có 29 thẻ, thẻ vẽ bằng bộ lọc thật', async () => {
  await studio().getByRole('tab', { name: 'Library' }).click()
  await studio().getByRole('tab', { name: 'Effects', exact: true }).click()
  const cards = studio().locator('.library-panel__section:not([hidden]) .library-card')
  await expect(cards).toHaveCount(29)
  // Thẻ hạt phim mang bộ lọc SVG của chính composition, không phải ảnh tĩnh.
  await expect(cards.filter({ hasText: 'Hạt phim' }).locator('filter feTurbulence')).toHaveCount(1)
})

test('bấm thẻ khi đã chọn clip thì CHỒNG thêm effect, cùng loại chồng được', async () => {
  await page.locator('.timeline-clip').first().click()
  const grid = studio().locator('.library-panel__section:not([hidden])')
  await grid.getByRole('button', { name: 'Đảo màu', exact: true }).click()
  await grid.locator('[data-effect-kind="vignette"]').click()
  await grid.locator('[data-effect-kind="vignette"]').click()
  const saved = await savedClip()
  expect(saved.effects?.map((effect) => effect.kind)).toEqual(['invert', 'vignette', 'vignette'])
  await expect(grid.locator('[data-effect-kind="vignette"]')).toContainText('×2')

  // Timeline gắn nhãn cho clip: nhiều loại effect gom thành một nhãn đếm tổng số.
  const tags = page.locator('.timeline-clip').first().locator('.timeline-clip__tag')
  await expect(tags).toHaveText(['Effect ×3'])
  await expect(page.locator('.timeline-clip').first()).toHaveAttribute(
    'title',
    /Effects: Đảo màu\nEffects: Tối góc ×2/
  )

  // Preview vẽ effect: lớp bọc media mang bộ lọc của clip.
  await expect(page.locator('[data-clip-id]').first().locator('xpath=..')).toHaveCSS(
    'filter',
    /url\("?#fx-/
  )
})

test('kéo thẻ thả lên clip cũng thêm effect', async () => {
  await studio()
    .getByRole('button', { name: 'Mặt nạ chữ nhật', exact: true })
    .dragTo(page.locator('.timeline-clip').first())
  expect((await savedClip()).effects?.at(-1)?.kind).toBe('rect-mask')
})

test('Inspector: chỉnh cường độ, thông số, đổi thứ tự, gỡ', async () => {
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await inspector.getByRole('tab', { name: 'Video', exact: true }).click()
  const items = inspector.locator('.effect-stack__item')
  await expect(items).toHaveCount(4)

  await inspector.getByLabel('Cường độ Đảo màu').fill('100')
  expect((await savedClip()).effects![0].intensity).toBe(1)

  // Mặt nạ: hộp nhỏ ở giữa, bo góc 0 — dùng để đo file xuất ra.
  const mask = items.nth(3)
  await mask.getByLabel('Rộng').fill('40')
  await mask.getByLabel('Cao').fill('40')
  await mask.getByLabel('Bo góc').fill('0')
  expect((await savedClip()).effects![3].params).toMatchObject({ width: 40, height: 40, radius: 0 })

  // Gỡ hai effect tối góc, rồi đưa mặt nạ lên đầu.
  await items
    .nth(1)
    .getByRole('button', { name: /^Gỡ effect/ })
    .click()
  await items
    .nth(1)
    .getByRole('button', { name: /^Gỡ effect/ })
    .click()
  await expect(items).toHaveCount(2)
  await items.nth(1).getByRole('button', { name: 'Áp sớm hơn' }).click()
  expect((await savedClip()).effects?.map((effect) => effect.kind)).toEqual(['rect-mask', 'invert'])

  // Một thao tác = một bước hoàn tác.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  expect((await savedClip()).effects?.map((effect) => effect.kind)).toEqual(['invert', 'rect-mask'])
})

test('effect đi tới file xuất ra: ngoài mặt nạ đen, trong mặt nạ là hình', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await expect(dialog.getByText(/phải dùng Remotion/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).first().click()
  await expect(dialog).toHaveCount(0)

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const luma = async (crop: string): Promise<{ avg: number; max: number }> => {
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
        `${crop},signalstats,metadata=print`,
        '-f',
        'null',
        '-'
      ],
      { encoding: 'utf8' }
    ).catch((error: { stderr: string }) => ({ stderr: error.stderr }))
    return {
      avg: Number(/lavfi\.signalstats\.YAVG=([\d.]+)/.exec(stderr)?.[1]),
      max: Number(/lavfi\.signalstats\.YMAX=([\d.]+)/.exec(stderr)?.[1])
    }
  }
  // Góc trên-trái nằm ngoài mặt nạ 40%: chỉ còn nền đen của dự án.
  const corner = await luma('crop=iw*0.2:ih*0.2:0:0')
  expect(corner.max).toBeLessThan(40)
  // Giữa khung: hình thật (đã đảo màu), không đen.
  const centre = await luma('crop=iw*0.3:ih*0.3:iw*0.35:ih*0.35')
  expect(centre.avg).toBeGreaterThan(40)
})

test('timeline gắn nhãn LUT và Zoom trước các effect', async () => {
  await page.locator('.timeline-clip').first().click()
  await studio().getByRole('tab', { name: 'Filters', exact: true }).click()
  await studio()
    .locator('.library-panel__section:not([hidden])')
    .getByRole('button', { name: 'Phim đen trắng', exact: true })
    .click()
  await studio().getByRole('tab', { name: 'Zoom', exact: true }).click()
  await studio()
    .locator('.library-panel__section:not([hidden])')
    .locator('.library-card')
    .first()
    .click()

  const clip = page.locator('.timeline-clip').first()
  await expect(clip.locator('.timeline-clip__tag').first()).toHaveAttribute(
    'data-tag-category',
    'lut'
  )
  await expect(clip.locator('.timeline-clip__tag').nth(1)).toHaveAttribute(
    'data-tag-category',
    'zoom'
  )
  await expect(clip.locator('.timeline-clip__tag--lut')).toHaveText('Phim đen trắng')
  await expect(clip.locator('.timeline-clip__tag--effect')).toHaveText('Effect ×2')
  // Tên đầy đủ kèm loại nằm trong tooltip của clip, vì nhãn không bắt chuột.
  await expect(clip).toHaveAttribute('title', /Filters: Phim đen trắng/)
  await page.screenshot({ path: process.env.FX_SHOT ?? 'test-results/timeline-tags.png' })
})
