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
import { SOUND_EFFECTS } from '../src/shared/domain/sound-effect-catalog'

/**
 * Thư viện hiệu ứng âm thanh dựng sẵn, chạy thật trong app.
 *
 * Điều cần chứng minh:
 *
 *   1. bản cài có ĐỦ file — thiếu file là lỗi đóng gói và phải lộ ra ở đây
 *   2. bấm một cái là thành asset THẬT, giải theo id chứ không theo đường dẫn
 *   3. đặt lên timeline thành clip, một bước hoàn tác cho cả asset lẫn clip
 *   4. tiếng đi tới file xuất ra, không chỉ nằm trong dự án
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-sfx-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-sfx-work-'))
  outputPath = join(workDir, 'ket-qua.mp4')
  const video = join(workDir, 'canh.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:size=320x180:rate=30:duration=4',
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
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.video] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { video, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án hiệu ứng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

async function savedDocument(): Promise<{
  assets: Array<{ id: string; name: string; source: { path: string; builtinId?: string } }>
  tracks: Array<{ kind: string; clips: Array<{ assetId?: string; durationUs: number }> }>
}> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as Awaited<ReturnType<typeof savedDocument>>
}

test('bản cài có ĐỦ file cho mọi hiệu ứng trong danh mục', async () => {
  // Thiếu file là lỗi đóng gói. Chỉ kiểm "có vài cái" thì một hiệu ứng rơi rụng
  // vẫn lọt, và người dùng bấm vào nó mới thấy lỗi.
  const available = await page.evaluate(async () => {
    const result = await window.api.soundEffects.list()
    return result.ok ? result.data.effects.map((effect) => effect.id) : []
  })
  expect([...available].sort()).toEqual(SOUND_EFFECTS.map((effect) => effect.id).sort())
})

test('nghe thử phát được tiếng thật trước khi thêm', async () => {
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('tab', { name: 'Nhạc nền' })
    .click()

  // Nút bật lên nghĩa là hàng đó đã có URL nghe thử — thiếu URL thì nút xám và
  // người dùng không nghe được gì.
  const previewButton = page.getByRole('button', { name: 'Nghe thử Keng' })
  await expect(previewButton).toBeEnabled()

  // ĐO byte trả về, không chỉ kiểm nút bấm được: một URL 404 cũng làm nút sáng
  // y hệt, và tiếng chỉ im lặng không báo gì.
  const served = await page.evaluate(async () => {
    const listed = await window.api.soundEffects.list()
    if (!listed.ok) return { status: 0, bytes: 0 }
    const one = listed.data.effects.find((effect) => effect.id === 'ding')
    if (!one) return { status: 0, bytes: 0 }
    const registered = await window.api.media.registerLocal([{ id: one.id, path: one.path }])
    if (!registered.ok) return { status: 0, bytes: 0 }
    const response = await fetch(registered.data[one.id])
    const body = await response.arrayBuffer()
    return { status: response.status, bytes: body.byteLength }
  })
  expect(served.status).toBe(200)
  expect(served.bytes).toBeGreaterThan(1000)

  // Cài chốt TRƯỚC khi bấm: hiệu ứng dài 800ms rồi tự tắt, nên đọc thuộc tính
  // sau đó là đua với chính nó — máy chậm một nhịp là đỏ oan.
  await page.evaluate(() => {
    const flags = window as unknown as { __sfxPressed?: boolean }
    flags.__sfxPressed = false
    new MutationObserver(() => {
      if (document.querySelector('.sound-effect-item [aria-pressed="true"]')) {
        flags.__sfxPressed = true
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-pressed']
    })
  })
  await previewButton.click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sfxPressed?: boolean }).__sfxPressed))
    .toBe(true)
})

test('thêm hiệu ứng vào thư viện thì thành asset thật, giải theo id', async () => {
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('tab', { name: 'Nhạc nền' })
    .click()
  const row = page.locator('.sound-effect-item').filter({ hasText: 'Keng' })
  await row.getByRole('button', { name: 'Chỉ thêm vào thư viện' }).click()

  // Thư viện media nằm ở tab Media, đang bị tab Nhạc nền che — nên kiểm CÓ MẶT
  // chứ không kiểm nhìn thấy. Bằng chứng thật nằm ở file dự án bên dưới.
  await expect(page.locator('.media-card', { hasText: 'Keng' })).toHaveCount(1)
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  const doc = await savedDocument()
  const asset = doc.assets.find((item) => item.source.builtinId === 'ding')
  expect(asset).toBeDefined()
  // Dự án lưu ID. Đường dẫn chỉ là kết quả phân giải của lần chạy này — gỡ app
  // hay mở trên máy khác thì nó sai, và id mới là thứ trỏ lại được.
  expect(asset!.source.builtinId).toBe('ding')
})

test('đặt hiệu ứng lên timeline là MỘT bước hoàn tác cho cả asset lẫn clip', async () => {
  const before = await savedDocument()
  const assetsBefore = before.assets.length

  const row = page.locator('.sound-effect-item').filter({ hasText: 'Bốp' })
  await row.getByRole('button', { name: 'Đặt vào timeline' }).click()

  await expect(page.locator('.timeline-lane--audio .timeline-clip')).toHaveCount(1)
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  const after = await savedDocument()
  expect(after.assets).toHaveLength(assetsBefore + 1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.timeline-lane--audio .timeline-clip')).toHaveCount(0)
  // Một lần hoàn tác gỡ CẢ HAI: còn sót asset thì thư viện đầy rác sau vài lần thử.
  await expect
    .poll(async () => (await savedDocument()).assets.length, { timeout: 15_000 })
    .toBe(assetsBefore)
})

test('tiếng đi tới file xuất ra, không chỉ nằm trong dự án', async () => {
  const row = page.locator('.sound-effect-item').filter({ hasText: 'Đập mạnh' })
  await row.getByRole('button', { name: 'Đặt vào timeline' }).click()
  await expect(page.locator('.timeline-lane--audio .timeline-clip')).toHaveCount(1)

  await page.getByRole('button', { name: 'Xuất video' }).click()
  await page.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await page.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(page.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })

  // ĐO tiếng trong file, không chỉ kiểm file tồn tại: một bản xuất câm cũng nặng
  // chừng đó và cũng "thành công".
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stderr } = await execFileAsync(
    String(ffmpegStatic),
    ['-hide_banner', '-i', outputPath, '-filter:a', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' }
  ).catch((error: { stderr: string }) => ({ stderr: error.stderr }))

  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr)
  expect(peak).not.toBeNull()
  expect(Number(peak![1])).toBeGreaterThan(-40)
})
