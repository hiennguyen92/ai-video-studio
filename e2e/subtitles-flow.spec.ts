import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
 * Luồng phụ đề đầu-cuối.
 *
 * Phép thử quan trọng nhất không phải là "giao diện tạo được cue", mà là cue đó
 * ĐI TỚI ĐƯỢC cả hai đầu ra: vẽ chồng lên preview, và nung vào file MP4 thật.
 * Cùng một dữ liệu, hai đường ra — đúng yêu cầu không được có hai nguồn trạng
 * thái riêng.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-subs-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-subs-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=25:duration=10',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=10:sample_rate=48000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án phụ đề')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

/**
 * Ghi transcript thẳng vào project.json rồi mở lại dự án.
 *
 * Không dựng cửa hậu trong mã sản phẩm chỉ để kiểm thử. `assetId` phải khớp với
 * asset đã import thật, nếu không sẽ không có clip nào để quy đổi thời gian.
 */
async function seedTranscriptForImportedAsset(): Promise<void> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')

  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    assets: Array<{ id: string }>
    transcripts: unknown[]
    revision: number
  }
  const assetId = document.assets[0].id

  document.transcripts = [
    {
      id: 'tr_sub',
      assetId,
      language: 'en',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: new Date().toISOString(),
      segments: [
        { id: 'seg_1', startUs: 500_000, endUs: 2_500_000, text: 'First caption', edited: false },
        {
          id: 'seg_2',
          startUs: 3_000_000,
          endUs: 5_000_000,
          text: 'Second caption',
          edited: false
        }
      ]
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')
}

/** Chạy một lượt xuất, chọn (hoặc bỏ chọn) track phụ đề để nung. Trả về đường dẫn. */
async function exportOnce(subtitleTrackLabel: string): Promise<string> {
  const target = join(workDir, `xuat-${subtitleTrackLabel ? 'co-phu-de' : 'khong-phu-de'}.mp4`)
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, target)

  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await expect(dialog).toBeVisible()

  const burnSelect = dialog.getByLabel('Nung phụ đề vào hình')
  await expect(burnSelect).toBeVisible()
  await burnSelect.selectOption(subtitleTrackLabel ? { label: subtitleTrackLabel } : '')

  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 180_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  return target
}

/** Trích một khung hình thành PNG để so sánh từng điểm ảnh. */
async function frameAt(videoPath: string, seconds: number): Promise<Buffer> {
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const framePath = join(workDir, `khung-${Date.now().toString(36)}.png`)
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-ss',
    String(seconds),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    framePath
  ])
  return readFile(framePath)
}

test('nhập media, đặt lên timeline và nạp bản phiên âm', async () => {
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await seedTranscriptForImportedAsset()
  await page.locator('.project-card__open', { hasText: 'Dự án phụ đề' }).click()

  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('tạo track phụ đề từ bản phiên âm', async () => {
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()
  await page.getByRole('button', { name: 'Tạo track phụ đề' }).click()

  // Hai đoạn lời nói → hai cue, mốc thời gian lấy từ transcript.
  await expect(page.locator('.cue-row')).toHaveCount(2)
  await expect(page.locator('.cue-row').first()).toContainText('First caption')

  // Tạo bản phụ đề thôi chưa đủ: phải có lane trên timeline trỏ tới nó, nếu
  // không thì preview và lúc xuất đều không thấy gì.
  await expect(page.locator('.track-head__name', { hasText: 'Phụ đề en' })).toBeVisible()
})

test('cue hiện lên preview đúng thời điểm và biến mất khi ra ngoài khoảng', async () => {
  // Tua vào giữa cue đầu tiên.
  await page.locator('.cue-row').first().locator('.cue-row__time').click()
  await expect(page.locator('.subtitle-overlay')).toContainText('First caption')

  // Sang cue thứ hai: cue đầu phải BIẾN MẤT, không dính lại trên màn hình.
  await page.locator('.cue-row').nth(1).locator('.cue-row__time').click()
  await expect(page.locator('.subtitle-overlay')).toContainText('Second caption')
  await expect(page.locator('.subtitle-overlay')).not.toContainText('First caption')
})

test('sửa cue đổi luôn chữ trên preview', async () => {
  const firstCue = page.locator('.cue-row').first()
  await firstCue.locator('textarea').first().fill('Chữ đã sửa')
  await expect(firstCue.locator('.cue-row__badge')).toHaveText('đã sửa')

  await firstCue.locator('.cue-row__time').click()
  // Cùng một nguồn dữ liệu nên preview đổi theo ngay, không cần dựng lại gì.
  await expect(page.locator('.subtitle-overlay')).toContainText('Chữ đã sửa')
})

test('đổi kiểu chữ được lưu vào dự án', async () => {
  await page.getByLabel('Cỡ chữ').fill('72')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.locator('.project-card__open', { hasText: 'Dự án phụ đề' }).click()
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()

  await expect(page.getByLabel('Cỡ chữ')).toHaveValue('72')
  await expect(page.locator('.cue-row')).toHaveCount(2)
})

test('phụ đề nung được vào file MP4 thật', async () => {
  const withSubs = await exportOnce('Phụ đề en')
  const withoutSubs = await exportOnce('')

  const stats = await stat(withSubs)
  expect(stats.size).toBeGreaterThan(10_000)

  const { default: ffprobeInstaller } = await import('@ffprobe-installer/ffprobe')
  const { stdout } = await execFileAsync(ffprobeInstaller.path, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    withSubs
  ])
  const probed = JSON.parse(stdout) as { streams: Array<{ codec_type: string }> }
  expect(probed.streams.some((stream) => stream.codec_type === 'video')).toBe(true)

  // Bằng chứng thật sự cho việc NUNG: hình tại thời điểm có phụ đề phải khác
  // hẳn cùng thời điểm ở bản không nung. Chỉ kiểm "file xuất ra được" thì bộ
  // lọc phụ đề hỏng vẫn lọt qua mà không ai biết.
  const framed = await frameAt(withSubs, 1)
  const plain = await frameAt(withoutSubs, 1)
  expect(framed.equals(plain)).toBe(false)
})
