import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
 * Phụ đề nổi bật từng chữ, chạy thật trong app: bật ở panel, thấy chữ sáng đổi
 * theo đầu phát trên preview, và bản NUNG vào MP4 sáng đúng chữ đó ở đúng giây.
 *
 * Nền video xám đặc có chủ ý: điểm ảnh vàng trên hình chỉ có thể đến từ chữ sáng,
 * nên đếm điểm vàng ở nửa trái / nửa phải là biết chữ nào đang sáng.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

const WIDTH = 640
const HEIGHT = 360

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-word-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-word-work-'))
  const video = join(workDir, 'noi.mp4')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x202020:size=${WIDTH}x${HEIGHT}:rate=25:duration=5`,
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=5:sample_rate=48000',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Chữ sáng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  // Transcript mang mốc TỪNG CHỮ như whisper trả về; ghi thẳng vào file dự án
  // thay vì dựng cửa hậu trong mã sản phẩm.
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')
  const document = JSON.parse(await readFile(documentFile, 'utf8'))
  document.transcripts = [
    {
      id: 'tr_word',
      assetId: document.assets[0].id,
      language: 'en',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: '2026-01-01T00:00:00.000Z',
      segments: [
        {
          id: 'seg',
          startUs: 1_000_000,
          endUs: 3_000_000,
          text: 'HELLO WORLD',
          edited: false,
          words: [
            { text: 'HELLO', startUs: 1_000_000, endUs: 1_600_000 },
            { text: 'WORLD', startUs: 2_000_000, endUs: 2_700_000 }
          ]
        }
      ]
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')
  await page.locator('.project-card__open', { hasText: 'Chữ sáng' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })
const litWord = (): ReturnType<Page['locator']> => page.locator('.subtitle-cue [data-word-lit]')

/** Đưa đầu phát tới `fraction` chiều dài câu, bằng cách bấm thước thời gian. */
async function seekInsideCue(fraction: number): Promise<void> {
  const block = (await page.locator('.timeline-text-block--subtitle').first().boundingBox())!
  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  await page.mouse.click(block.x + block.width * fraction, ruler.y + ruler.height / 2)
}

test('bật tô chữ đang nói: chữ sáng trên preview đổi theo đầu phát', async () => {
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()
  await page.getByRole('button', { name: 'Tạo track phụ đề' }).click()
  await expect(page.locator('.timeline-text-block--subtitle')).toHaveCount(1)

  await studio().getByRole('button', { name: 'Nổi bật từng chữ' }).click()
  await studio().getByLabel('Tô chữ').selectOption({ label: 'Chữ đang nói' })

  await seekInsideCue(0.25)
  await expect(litWord()).toHaveText('HELLO')
  await seekInsideCue(0.75)
  await expect(litWord()).toHaveText('WORLD')
  // Chỉ một chữ sáng mỗi lúc, và đúng màu đã chọn.
  await expect(litWord()).toHaveCount(1)
  await expect(litWord()).toHaveCSS('color', 'rgb(255, 228, 92)')
})

test('tô dần theo lời: chữ đã nói giữ màu', async () => {
  await studio().getByLabel('Tô chữ').selectOption({ label: 'Tô dần theo lời' })
  await seekInsideCue(0.75)
  await expect(litWord()).toHaveCount(2)
  await studio().getByLabel('Tô chữ').selectOption({ label: 'Chữ đang nói' })
})

/** Số điểm ảnh vàng ở nửa trái và nửa phải của khung hình tại `seconds`. */
async function yellowPixels(videoPath: string, seconds: number): Promise<[number, number]> {
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stdout } = await execFileAsync(
    String(ffmpegStatic),
    ['-v', 'error', '-ss', String(seconds), '-i', videoPath, '-frames:v', '1']
      .concat(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
      .map(String),
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 }
  )
  const counts: [number, number] = [0, 0]
  for (let offset = 0; offset + 2 < stdout.length; offset += 3) {
    const [r, g, b] = [stdout[offset], stdout[offset + 1], stdout[offset + 2]]
    if (r > 200 && g > 170 && b < 150) counts[(offset / 3) % WIDTH < WIDTH / 2 ? 0 : 1] += 1
  }
  return counts
}

test('bản nung vào MP4 sáng đúng chữ ở đúng giây', async () => {
  const target = join(workDir, 'chu-sang.mp4')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, target)
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByLabel('Nung phụ đề vào hình').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 180_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  // HELLO (nửa trái) sáng lúc 1,5 s; WORLD (nửa phải) sáng lúc 2,5 s.
  const [earlyLeft, earlyRight] = await yellowPixels(target, 1.5)
  const [lateLeft, lateRight] = await yellowPixels(target, 2.5)
  expect(earlyLeft).toBeGreaterThan(50)
  expect(earlyLeft).toBeGreaterThan(earlyRight * 4)
  expect(lateRight).toBeGreaterThan(50)
  expect(lateRight).toBeGreaterThan(lateLeft * 4)
  // Ngoài câu thì không có gì vàng.
  const [noneLeft, noneRight] = await yellowPixels(target, 4)
  expect(noneLeft + noneRight).toBe(0)
})
