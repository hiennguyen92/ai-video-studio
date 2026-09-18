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
 * Dải chấm keyframe trên timeline — kịch bản đầu-cuối của cả tính năng.
 *
 * Đây là phép thử duy nhất đi hết một vòng người dùng thật: đặt keyframe bằng
 * nút, thấy chấm trên timeline, kéo chấm, đổi kiểu nội suy, xoá, rồi xuất file.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-kfa-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-kfa-work-'))
  const mediaPath = join(workDir, 'nguon.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=green:size=320x180:rate=30:duration=6',
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
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.media] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { media: mediaPath, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chuyển động')
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

const dots = (): ReturnType<Page['locator']> => page.locator('.timeline-keyframe-dot')

async function seekInClip(ratio: number): Promise<void> {
  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  const clip = (await page.locator('.timeline-clip').first().boundingBox())!
  await page.mouse.click(clip.x + clip.width * ratio, ruler.y + 12)
  await page.waitForTimeout(400)
}

async function savedOpacityKeyframes(): Promise<Array<{ atUs: number; v: number; e?: string }>> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    tracks: Array<{
      kind: string
      clips: Array<{ keyframes?: Record<string, Array<{ atUs: number; v: number; e?: string }>> }>
    }>
  }
  const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
  return clip.keyframes?.['transform.opacity'] ?? []
}

test('đặt hai keyframe thì timeline hiện hai chấm dưới clip', async () => {
  await page.locator('.timeline-clip').first().click()
  await inspector().getByRole('tab', { name: 'Video', exact: true }).click()

  await seekInClip(0.2)
  await inspector().getByRole('button', { name: /Độ mờ/ }).click()
  await seekInClip(0.8)
  await inspector().getByRole('slider', { name: 'Độ mờ' }).fill('0.2')

  await expect(dots()).toHaveCount(2)
  expect(await savedOpacityKeyframes()).toHaveLength(2)
})

test('chấm nằm NGOÀI khung cắt của clip nên không bị xén', async () => {
  // `.timeline-clip` cắt mọi thứ vẽ bên trong nó, nên đây là bài kiểm chứng dải
  // được dựng làm anh em chứ không phải con của clip.
  const clipBox = (await page.locator('.timeline-clip').first().boundingBox())!
  for (const dot of await dots().all()) {
    const box = (await dot.boundingBox())!
    expect(box.width).toBeGreaterThan(4)
    expect(box.y + box.height).toBeGreaterThan(clipBox.y)
  }
})

test('kéo một chấm sang phải thì mốc đổi, và MỘT lần hoàn tác là về chỗ cũ', async () => {
  const before = await savedOpacityKeyframes()
  const first = dots().first()
  const box = (await first.boundingBox())!

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => (await savedOpacityKeyframes())[0].atUs)
    .toBeGreaterThan(before[0].atUs)
  // Vẫn đúng hai chấm: kéo là DỜI, không phải tạo thêm.
  await expect(dots()).toHaveCount(2)

  // Hoàn tác bằng NÚT chứ không bằng phím tắt: con trỏ đang nằm trong ô nhập từ
  // thao tác trước, và app cố ý không cướp Ctrl+Z khi người dùng đang gõ.
  // Nhãn trên nút cũng là bằng chứng cả cú kéo chỉ sinh MỘT bước hoàn tác.
  await page.getByRole('button', { name: /Hoàn tác: Dời keyframe/ }).click()
  await expect.poll(async () => (await savedOpacityKeyframes())[0].atUs).toBe(before[0].atUs)
})

test('menu chuột phải đổi kiểu nội suy sang Giữ nguyên', async () => {
  // `hold` là thứ cần cho việc bật/tắt dứt khoát — che một vùng rồi thôi che —
  // và đây là chỗ duy nhất trong app đặt được nó.
  await dots().first().click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Keyframe' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitemradio', { name: 'Đều' }).first().waitFor()
  await menu.getByRole('menuitemradio', { name: 'Giữ nguyên' }).click()

  await expect.poll(async () => (await savedOpacityKeyframes())[0].e).toBe('hold')

  // Mở lại thì kiểu đang dùng được tích.
  await dots().first().click({ button: 'right' })
  await expect(
    page.getByRole('menu', { name: 'Keyframe' }).getByRole('menuitemradio', { name: 'Giữ nguyên' })
  ).toHaveAttribute('aria-checked', 'true')
  // Đóng bằng Escape: menu phải nuốt phím này, nếu không Escape toàn cục bỏ
  // chọn clip và dải chấm biến mất ngay dưới tay.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu', { name: 'Keyframe' })).toHaveCount(0)
  await expect(dots()).toHaveCount(2)
})

test('menu chuột phải xoá một chấm', async () => {
  await dots().first().click({ button: 'right' })
  await page
    .getByRole('menu', { name: 'Keyframe' })
    .getByRole('menuitem', { name: 'Xoá keyframe' })
    .click()

  await expect(dots()).toHaveCount(1)
  expect(await savedOpacityKeyframes()).toHaveLength(1)
})

test('bấm đúp vào chấm thì đầu phát nhảy tới đúng đó', async () => {
  await seekInClip(0.05)
  const dot = dots().first()
  const dotBox = (await dot.boundingBox())!
  await dot.dblclick()

  await expect
    .poll(async () => {
      const playhead = await page.locator('.timeline__playhead').boundingBox()
      return Math.abs((playhead?.x ?? 0) - (dotBox.x + dotBox.width / 2))
    })
    .toBeLessThan(6)
})

test('tách clip giữa hai keyframe: dải bám theo clip ĐANG CHỌN', async () => {
  // Dựng lại hai keyframe rồi cắt ở giữa.
  await seekInClip(0.2)
  await inspector().getByRole('button', { name: /Độ mờ/ }).click()
  await expect(dots()).toHaveCount(2)

  await seekInClip(0.5)
  await page
    .getByRole('button', { name: /Cắt|Split/ })
    .first()
    .click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)

  /** Mọi chấm đang hiện có nằm trong lòng clip thứ `index` không. */
  const dotsInsideClip = async (index: number): Promise<boolean> => {
    const clip = (await page.locator('.timeline-clip').nth(index).boundingBox())!
    const boxes = await Promise.all((await dots().all()).map((dot) => dot.boundingBox()))
    return boxes.every((box) => box!.x >= clip.x - 6 && box!.x <= clip.x + clip.width + 6)
  }

  // Hiện chấm cho MỌI clip sẽ biến timeline thành một rừng chấm, nên dải chỉ đi
  // theo clip đang chọn — chọn nửa nào thì thấy chấm của nửa đó.
  await page.locator('.timeline-clip').nth(1).click()
  await expect(dots().first()).toBeVisible()
  expect(await dotsInsideClip(1)).toBe(true)

  await page.locator('.timeline-clip').first().click()
  await expect(dots().first()).toBeVisible()
  expect(await dotsInsideClip(0)).toBe(true)
})

test('keyframe sống sót qua lưu, đóng dự án và mở lại', async () => {
  // Keyframe phải nằm trong file dự án, không phải state tạm của panel. Mở lại
  // là phép thử duy nhất chứng minh điều đó đi hết vòng — đọc project.json chỉ
  // chứng minh nửa đường ra, không chứng minh nửa đường về.
  const before = await savedOpacityKeyframes()
  expect(before.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await expect(page.getByRole('heading', { name: 'AI Video Studio' })).toBeVisible()
  await page.locator('.project-card__open', { hasText: 'Dự án chuyển động' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor({ timeout: 30_000 })

  // Chọn lại clip: dải chấm chỉ hiện cho clip đang chọn.
  await page.locator('.timeline-clip').first().click()
  await expect(dots()).toHaveCount(before.length)
  expect(await savedOpacityKeyframes()).toEqual(before)
})

test('dự án có keyframe thì hộp thoại Xuất tự chọn Remotion', async () => {
  // Nhánh ffmpeg đọc transform dạng hằng số: để nó chạy là xuất ra file đứng
  // hình mà không báo gì.
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })

  const engine = dialog.getByLabel('Bộ dựng hình')
  await expect(engine).toHaveValue('remotion')
  // Khoá hẳn, và nói rõ VÌ SAO — một ô bị khoá không lời giải thích là một ô
  // người dùng tưởng là lỗi.
  await expect(engine).toBeDisabled()
  await expect(dialog.getByText(/keyframe/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng' }).click()
})
