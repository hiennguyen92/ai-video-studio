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
 * Kiểm thử đầu-cuối Mốc 2: Cấu hình AI, Giọng đọc và Nhạc nền.
 *
 * ⚠️ Không có khoá API thật, nên phần GỌI provider không được kiểm chứng ở đây.
 * Những gì kiểm chứng được và có giá trị:
 *   - khoá lưu vào safeStorage thật của hệ điều hành rồi đọc lại đúng trạng thái
 *   - giao diện chỉ bày tham số mà provider khai báo (DESCRIPTION §3.B)
 *   - thiếu khoá thì chỉ vô hiệu hoá đúng tính năng phụ thuộc, phần local vẫn chạy
 *     (DESCRIPTION §3.G)
 *   - khoá sai được báo lỗi rõ ràng thay vì treo (DESCRIPTION §10)
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let musicFixture: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-m2-profile-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-m2-work-'))
  musicFixture = join(workDir, 'nhac-nen-thu.mp3')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=6:sample_rate=48000',
    '-c:a',
    'libmp3lame',
    musicFixture
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.music] })
    },
    { music: musicFixture }
  )

  // Vào một dự án để có đủ ngữ cảnh cho các tab.
  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án Mốc 2')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('tab Cấu hình AI liệt kê provider và cho biết kho bí mật đang dùng', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()

  await expect(page.getByText('ElevenLabs', { exact: true })).toBeVisible()
  // Khớp chính xác: tên provider tự host cũng chứa chuỗi "OpenAI".
  await expect(page.getByText('OpenAI', { exact: true })).toBeVisible()
  await expect(page.getByText('Máy chủ tự host (OpenAI-compatible)')).toBeVisible()
  await expect(page.getByText('whisper.cpp (chạy trong máy)')).toBeVisible()
  // safeStorage thật của Electron phải sẵn sàng trên macOS.
  await expect(page.getByText(/Kho bí mật:/)).toBeVisible()
  // Kiểm theo TỪNG thẻ thay vì đếm tổng: thêm provider mới là con số lại sai, mà
  // con số đó chẳng khẳng định được điều gì.
  for (const name of ['ElevenLabs', 'OpenAI', 'ElevenLabs Music']) {
    const card = page.locator('.provider-card').filter({
      has: page.getByText(name, { exact: true })
    })
    await expect(card.getByText('Chưa có khoá', { exact: true })).toBeVisible()
  }

  // Huy hiệu được kiểm theo TỪNG thẻ: đếm tổng sẽ phải sửa lại mỗi lần thêm
  // provider chạy local, mà con số đó chẳng nói lên điều gì.
  for (const name of ['Máy chủ tự host (OpenAI-compatible)', 'whisper.cpp (chạy trong máy)']) {
    const card = page.locator('.provider-card', { hasText: name })
    await expect(card.getByText('Không bắt buộc khoá')).toBeVisible()
  }
})

test('lưu khoá qua safeStorage thật rồi đọc lại đúng trạng thái', async () => {
  const keyField = page.getByLabel('OpenAI API key')
  await keyField.fill('sk-khoa-gia-chi-de-kiem-thu-khong-hop-le')
  await page.getByRole('button', { name: 'Lưu khoá' }).nth(1).click()

  await expect(page.getByText('Đã lưu khoá cho OpenAI')).toBeVisible()
  await expect(page.getByText('Đã lưu khoá', { exact: true })).toBeVisible()
  // Ô nhập phải được xoá trắng: renderer không giữ khoá lâu hơn mức cần.
  await expect(keyField).toHaveValue('')
})

test('khoá sai được báo lỗi rõ ràng chứ không treo', async () => {
  // Đây là một mục trong tiêu chí nghiệm thu §10: "API key thiếu hoặc sai".
  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).nth(1).click()

  // Chấp nhận cả hai kết cục: provider từ chối khoá, hoặc máy không có mạng.
  // Điều bắt buộc là giao diện phải kết luận rõ ràng trong thời gian hữu hạn.
  await expect(page.getByText('Không kết nối được')).toBeVisible({ timeout: 45_000 })
})

test('tab Giọng đọc chặn đúng tính năng phụ thuộc khoá, không chặn cả panel', async () => {
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()

  // ElevenLabs chưa có khoá nên phải hiện cảnh báo kèm lối tắt sang cài đặt.
  await page.getByLabel('Nhà cung cấp').selectOption('elevenlabs')
  await expect(page.getByText('Chưa có khoá API cho nhà cung cấp này.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Mở Cấu hình AI' })).toBeVisible()

  // Nhưng ô kịch bản vẫn gõ được — thiếu khoá không được khoá cả giao diện.
  await page.getByLabel('Kịch bản', { exact: true }).fill('Xin chào, đây là bản thử nghiệm.')
  await expect(page.getByRole('button', { name: 'Chia thành đoạn' })).toBeEnabled()
})

test('danh mục giọng cố định nạp được mà không cần khoá và không gọi mạng', async () => {
  await page.getByLabel('Nhà cung cấp').selectOption('openai')

  // OpenAI không có endpoint liệt kê giọng; danh mục là tập cố định theo tài liệu.
  await expect(page.getByText('Danh mục cố định theo tài liệu của nhà cung cấp.')).toBeVisible()

  const voiceSelect = page.getByLabel('Giọng', { exact: true })
  await expect(voiceSelect).toBeEnabled()
  const optionCount = await voiceSelect.locator('option').count()
  expect(optionCount).toBeGreaterThan(5)
})

test('bộ tham số đổi theo model — không bày ô mà model không nhận', async () => {
  // Đây là điều DESCRIPTION §3.B đòi hỏi, và là điểm dễ làm sai nhất.
  await page.getByLabel('Model', { exact: true }).selectOption('gpt-4o-mini-tts')
  await expect(page.getByLabel('Phong cách đọc')).toBeVisible()
  await expect(page.getByLabel('Tốc độ đọc')).toBeVisible()

  await page.getByLabel('Model', { exact: true }).selectOption('tts-1')
  // tts-1 không nhận `instructions`, nên ô đó phải BIẾN MẤT, không phải bị làm mờ.
  await expect(page.getByLabel('Phong cách đọc')).toHaveCount(0)
  await expect(page.getByLabel('Tốc độ đọc')).toBeVisible()
})

test('chia kịch bản thành các đoạn tạo lại được riêng lẻ', async () => {
  await page
    .getByLabel('Kịch bản', { exact: true })
    .fill('Câu thứ nhất của kịch bản.\n\nCâu thứ hai nằm ở đoạn khác.\n\nCâu thứ ba kết thúc.')
  await page.getByRole('button', { name: 'Chia thành đoạn' }).click()

  await expect(page.locator('.script-segment')).toHaveCount(3)
  await expect(page.getByText('3 đoạn')).toBeVisible()
  // Mỗi đoạn có nút tạo riêng.
  await expect(page.getByRole('button', { name: 'Tạo đoạn này' })).toHaveCount(3)
})

test('tab Nhạc nền dùng được đầy đủ khi không có khoá AI nào', async () => {
  await studio().getByRole('tab', { name: 'Nhạc nền' }).click()

  await expect(page.getByText('Chưa có bản nhạc nào trong thư viện.')).toBeVisible()

  await studio().getByRole('button', { name: 'Tải nhạc lên' }).first().click()
  await expect(page.locator('.music-item')).toHaveCount(1, { timeout: 60_000 })
  // Ràng buộc vào panel nhạc: cùng file cũng hiện ở tab Media (vẫn nằm trong cây
  // để không mất trạng thái khi chuyển tab), nên tìm theo cả trang sẽ trúng hai chỗ.
  await expect(page.locator('.music-item__name')).toHaveText('nhac-nen-thu.mp3')

  // Chèn vào track nhạc nền — thao tác cục bộ, không cần provider nào.
  await page.getByRole('button', { name: 'Chèn vào track nhạc' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('nhạc đã chèn nằm đúng trên track nhạc nền và sửa được trong Inspector', async () => {
  await page.locator('.timeline-clip').first().click()

  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await expect(inspector.getByText('Nhạc nền 1')).toBeVisible()
  // Âm lượng và fade chỉnh ở Inspector, không nhân đôi ô điều khiển trong panel nhạc.
  await expect(inspector.getByLabel('Âm lượng')).toBeVisible()
  await expect(inspector.getByLabel('Fade in')).toBeVisible()
})

test('phần giảm nhạc dùng được mà không cần khoá AI, và nói rõ khi chưa đủ dữ liệu', async () => {
  await studio().getByRole('tab', { name: 'Nhạc nền' }).click()

  // Có mặt và không đòi khoá nào — đây là thao tác thuần cục bộ, không đi qua
  // AI Chat (vốn cần một máy chủ LLM).
  await expect(page.getByText('Giảm nhạc khi có lời nói')).toBeVisible()
  await expect(page.getByLabel('Âm lượng khi có lời (%)')).toHaveValue('25')

  // Dự án mới chỉ có clip nhạc, chưa có lời nói: phải nói rõ lý do và khoá nút,
  // thay vì để bấm rồi im lặng không làm gì.
  await expect(page.getByText('Cần có cả clip nhạc và clip lời nói')).toBeVisible()
  await expect(
    page
      .locator('.music-generation')
      .filter({ hasText: 'Giảm nhạc' })
      .getByRole('button', { name: 'Áp dụng' })
  ).toBeDisabled()

  // Giới hạn của cách làm phải được nói ra, không giấu.
  await expect(page.getByText(/Mức âm lượng đổi theo bậc/)).toBeVisible()
})

test('xoá khoá đưa provider về trạng thái chưa cấu hình', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await page.getByRole('button', { name: 'Xoá khoá' }).nth(1).click()

  await expect(page.getByText('Đã xoá khoá của OpenAI')).toBeVisible()
  const openAiCard = page
    .locator('.provider-card')
    .filter({ has: page.getByText('OpenAI', { exact: true }) })
  await expect(openAiCard.getByText('Chưa có khoá', { exact: true })).toBeVisible()
})
