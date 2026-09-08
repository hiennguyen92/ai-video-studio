import { mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
 * Kiểm thử đầu-cuối phiên âm CHẠY THẬT bằng whisper.cpp.
 *
 * Cần whisper-cli đã cài và một model ggml:
 *
 *   brew install whisper-cpp
 *   WHISPER_MODEL_PATH=~/ggml-medium.bin npx playwright test e2e/transcription-live
 *
 * Không có model thì cả nhóm bị bỏ qua.
 *
 * Đây là phép thử chứng minh chuỗi hoàn chỉnh: clip trên timeline → trích audio
 * bằng ffmpeg → whisper.cpp nhận dạng → transcript vào project → sửa được →
 * nhấn để tua preview. Không có bước nào bị giả lập.
 */

const execFileAsync = promisify(execFile)
const modelPath = process.env.WHISPER_MODEL_PATH

/**
 * Đoạn đọc thử. Từ thông dụng, phát âm rõ để model nhỏ (base.en) cũng nghe ra,
 * nhờ vậy test không đòi model vài GB mới chạy được.
 *
 * Phải đủ dài để whisper chia thành NHIỀU đoạn: chỉ một đoạn thì nó bắt đầu ở
 * giây 0, và phép thử tua sẽ không phân biệt được "tua đúng chỗ" với "không tua".
 */
const SPOKEN_SENTENCE =
  'The quick brown fox jumps over the lazy dog. ' +
  'Software teams review every change before shipping it. ' +
  'Local transcription keeps audio on your own machine.'

test.skip(!modelPath, 'Cần WHISPER_MODEL_PATH để chạy whisper.cpp thật')
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-stt-profile-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-stt-work-'))
  mediaPath = join(workDir, 'canh-quay-co-tieng.mp4')

  // Giọng nói THẬT do macOS tổng hợp. Sóng sine không phải tiếng nói nên whisper
  // trả về đoạn rỗng hoặc chữ bịa — không chứng minh được gì. Có lời thật thì mới
  // khẳng định được cả chuỗi trích audio → nhận dạng → transcript chạy đúng.
  const speechPath = join(workDir, 'loi-thoai.aiff')
  await execFileAsync('say', ['-v', 'Samantha', '-o', speechPath, SPOKEN_SENTENCE])

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=25:duration=12',
    '-i',
    speechPath,
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
    },
    { media: mediaPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Phiên âm thật')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('tab Phiên âm nói rõ chưa chọn clip và chưa có model', async () => {
  await studio().getByRole('tab', { name: 'Phiên âm' }).click()

  await expect(page.getByText('Chọn một clip trên timeline để phiên âm.')).toBeVisible()
  // Nút bắt đầu phải bị khoá khi thiếu điều kiện, không để người dùng bấm rồi mới lỗi.
  await expect(page.getByRole('button', { name: 'Bắt đầu phiên âm' })).toBeDisabled()
  // Giới hạn của whisper.cpp phải được nói ra, không giấu.
  await expect(page.getByText(/chỉ phân biệt người nói với audio hai kênh/)).toBeVisible()
})

test('trỏ tới model đã tải sẵn qua Cấu hình AI', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()

  const card = page.locator('.provider-card', { hasText: 'whisper.cpp' })
  await expect(card).toBeVisible()
  // Chạy trong máy nên không đòi khoá.
  await expect(card.getByText('Không bắt buộc khoá')).toBeVisible()

  // Ô thứ hai là "File model ggml" (ô đầu là đường dẫn whisper-cli).
  await card
    .locator('input[type="text"]')
    .nth(1)
    .fill(modelPath as string)
  await card.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(page.getByText(/Đã lưu cấu hình cho whisper\.cpp/)).toBeVisible()

  await card.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  // Kết quả phải nêu đúng binary và model đang dùng, không chỉ "OK" chung chung.
  const result = card.locator('.provider-card__test')
  await expect(result).toContainText('Kết nối được', { timeout: 30_000 })
  await expect(result).toContainText('whisper-cli')
  await expect(result).toContainText('ggml-base.en.bin')
})

test('phiên âm clip thật và transcript vào project', async () => {
  // Nhập media và đưa lên timeline.
  await studio().getByRole('tab', { name: 'Media' }).click()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 60_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
  await page.locator('.timeline-clip').first().click()

  await studio().getByRole('tab', { name: 'Phiên âm' }).click()
  await expect(page.getByText(/^Clip: /)).toBeVisible()

  // Đường dẫn model đã lưu ở tab Cấu hình AI phải tự hiện sang đây; nếu không thì
  // nút bắt đầu bị khoá vĩnh viễn dù cấu hình hoàn toàn hợp lệ.
  await expect(page.getByText(/^Model đang dùng: /)).toBeVisible()

  // Câu thử là tiếng Anh nên phải đổi ngôn ngữ, mặc định đang là tiếng Việt.
  await page.getByRole('tabpanel', { name: 'Phiên âm' }).getByLabel('Ngôn ngữ').selectOption('en')

  const startButton = page.getByRole('button', { name: 'Bắt đầu phiên âm' })
  await expect(startButton).toBeEnabled()
  await startButton.click()

  // whisper.cpp chạy thật trên CPU, cho nó thời gian.
  const segments = page.locator('.transcript-segment')
  await expect(segments.first()).toBeVisible({ timeout: 300_000 })

  // Nội dung phải khớp câu đã đọc — đây mới là bằng chứng nhận dạng thật sự chạy,
  // không phải chỉ có job chạy xong. So khớp lỏng vì model nhỏ hay sai hoa/thường
  // và dấu câu.
  // Đoạn dài phải được chia nhỏ, không dồn hết vào một khối chữ tràn màn hình.
  expect(await segments.count()).toBeGreaterThan(1)

  const spoken = (await segments.allTextContents()).join(' ').toLowerCase()
  expect(spoken).toContain('quick brown fox')
  expect(spoken).toContain('lazy dog')
  expect(spoken).toContain('own machine')

  // Sửa được và đánh dấu đã sửa — transcript là dữ liệu thật của project.
  const firstText = segments.first().locator('textarea')
  await firstText.fill('Câu đã sửa tay')
  await expect(segments.first().locator('.transcript-segment__badge')).toHaveText('đã sửa')

  // Nhấn mốc thời gian phải tua preview tới đúng chỗ, không đứng yên ở 0.
  const playhead = page.locator('.timeline__playhead')
  await expect(playhead).toHaveAttribute('style', 'left: 0px;')
  await segments.last().locator('.transcript-segment__time').click()
  // Đoạn cuối nằm ở giữa clip nên đầu phát phải rời khỏi mốc 0.
  await expect(playhead).not.toHaveAttribute('style', 'left: 0px;')
})

test('transcript sống sót qua lưu và mở lại dự án', async () => {
  // Transcript phải nằm trong project JSON, không phải state tạm của panel.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await expect(page.getByRole('heading', { name: 'AI Video Studio' })).toBeVisible()
  await page.locator('.project-card__open', { hasText: 'Phiên âm thật' }).click()

  await page.getByRole('region', { name: 'Timeline' }).waitFor({ timeout: 30_000 })
  await studio().getByRole('tab', { name: 'Phiên âm' }).click()
  await expect(page.getByText('Câu đã sửa tay')).toBeVisible({ timeout: 30_000 })
})
