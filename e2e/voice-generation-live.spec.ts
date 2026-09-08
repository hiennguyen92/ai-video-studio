import { mkdtemp, rm } from 'node:fs/promises'
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
 * Kiểm thử đầu-cuối GỌI API THẬT: từ nhập khoá tới clip nằm trên timeline.
 *
 * Chỉ chạy khi có `ELEVENLABS_API_KEY`; không có thì bỏ qua toàn bộ, nên máy
 * khác và CI vẫn chạy được phần còn lại.
 *
 *   ELEVENLABS_API_KEY=... npx playwright test e2e/voice-generation-live
 *
 * Đây là phép thử chứng minh tuyên bố cốt lõi của DESCRIPTION §4: "AI tạo giọng
 * đọc xong phải tạo asset và clip THẬT trong project, có thể kéo, cắt, sửa và
 * undo". Mọi phép thử khác chỉ kiểm chứng từng mảnh của chuỗi đó.
 */

const apiKey = process.env.ELEVENLABS_API_KEY

test.skip(!apiKey, 'Cần ELEVENLABS_API_KEY để gọi provider thật')
test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-live-e2e-'))

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Lồng tiếng thật')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('mở tab Giọng đọc TRƯỚC khi có khoá, panel phải nhận ra khoá mới sau đó', async () => {
  // Thứ tự này quan trọng: tab được giữ nguyên trong cây để không mất kịch bản
  // khi chuyển qua lại. Nếu panel chỉ đọc trạng thái khoá lúc dựng thì nó sẽ mãi
  // báo "chưa có khoá" dù người dùng vừa lưu khoá xong ở tab bên cạnh.
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()
  await page.getByLabel('Nhà cung cấp').selectOption('elevenlabs')
  await expect(page.getByText('Chưa có khoá API cho nhà cung cấp này.')).toBeVisible()
})

test('nhập khoá thật vào Keychain và kiểm tra kết nối thành công', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()

  await page.getByLabel('ElevenLabs API key').fill(apiKey as string)
  await page.getByRole('button', { name: 'Lưu khoá' }).first().click()
  await expect(page.getByText('Đã lưu khoá cho ElevenLabs')).toBeVisible()

  await page.getByRole('button', { name: 'Kiểm tra kết nối' }).first().click()
  await expect(page.getByText('Kết nối được')).toBeVisible({ timeout: 45_000 })
  // Thông tin chi tiết phải đến từ API thật, không phải chuỗi cố định.
  await expect(page.getByText(/model hỗ trợ tiếng Việt/)).toBeVisible()
})

test('tải danh sách giọng thật từ tài khoản', async () => {
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()

  // Panel vẫn là bản đã dựng từ trước khi có khoá; cảnh báo thiếu khoá phải biến
  // mất và nút tải giọng phải bật lên mà không cần mở lại ứng dụng.
  await expect(page.getByText('Chưa có khoá API cho nhà cung cấp này.')).toHaveCount(0)

  const loadButton = page.getByRole('button', { name: /Tải danh sách giọng|Đang tải giọng/ })
  await expect(loadButton).toBeEnabled()
  await loadButton.click()

  const voiceSelect = page.getByLabel('Giọng', { exact: true })
  await expect(voiceSelect).toBeEnabled({ timeout: 45_000 })
  const optionCount = await voiceSelect.locator('option').count()
  // Tài khoản thật có nhiều giọng; danh sách phải lấy được từ provider.
  expect(optionCount).toBeGreaterThan(3)
})

test('chọn model hỗ trợ tiếng Việt và giọng dùng được với gói hiện tại', async () => {
  // Model phải lấy từ API; chọn một model có tiếng Việt.
  const modelSelect = page.getByLabel('Model')
  const modelValues = await modelSelect
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))
  const vietnameseModel =
    modelValues.find((value) => value.includes('flash_v2_5')) ??
    modelValues.find((value) => value.includes('turbo_v2_5')) ??
    modelValues[0]
  await modelSelect.selectOption(vietnameseModel)

  // Giọng "thư viện" bị gói miễn phí từ chối, nên chọn giọng có sẵn.
  const voiceSelect = page.getByLabel('Giọng', { exact: true })
  const builtIn = await voiceSelect
    .locator('option')
    .evaluateAll((options) =>
      options
        .filter((option) => option.textContent?.includes('có sẵn'))
        .map((option) => (option as HTMLOptionElement).value)
    )
  expect(builtIn.length).toBeGreaterThan(0)
  await voiceSelect.selectOption(builtIn[0])
})

test('sinh giọng đọc tiếng Việt thật và asset vào thư viện', async () => {
  await page
    .getByLabel('Kịch bản', { exact: true })
    .fill('Xin chào, đây là bản thử nghiệm giọng đọc tiếng Việt của AI Video Studio.')
  await page.getByRole('button', { name: 'Chia thành đoạn' }).click()
  await expect(page.locator('.script-segment')).toHaveCount(1)

  await page.getByRole('button', { name: 'Tạo đoạn này' }).click()

  // Job chạy thật: đợi audio xuất hiện ngay trong đoạn kịch bản.
  await expect(page.locator('.script-segment__audio')).toBeVisible({ timeout: 120_000 })

  // Asset phải nằm trong thư viện media, gắn nhãn AI tạo.
  await studio().getByRole('tab', { name: 'Media' }).click()
  await expect(page.locator('.media-card')).toHaveCount(1)
  await expect(page.locator('.media-card__badge')).toBeVisible()

  // Thời lượng phải là số ĐO ĐƯỢC bằng ffprobe, không phải ước lượng.
  const duration = await page.locator('.media-card__duration').textContent()
  expect(duration).toMatch(/^00:00:\d{2}$/)
  expect(duration).not.toBe('00:00:00')
})

test('chèn giọng đọc vào timeline thành clip thật, cắt và hoàn tác được', async () => {
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()
  await page.getByRole('button', { name: 'Chèn tại playhead' }).last().click()

  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  // Clip nằm trên track lồng tiếng và có thuộc tính sửa được.
  await page.locator('.timeline-clip').first().click()
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await expect(inspector.getByText('Lồng tiếng 1')).toBeVisible()
  await expect(inspector.getByLabel('Âm lượng')).toBeVisible()

  // Cắt được như mọi clip khác — đây là điều DESCRIPTION §4 đòi hỏi ở nội dung AI.
  const ruler = await page.locator('.timeline__ruler-row').boundingBox()
  await page.mouse.click(ruler!.x + 90, ruler!.y + 12)
  await page.locator('.timeline-clip').first().click()
  await page.getByRole('button', { name: 'Cắt tại playhead' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)

  // Và hoàn tác được.
  await page.getByRole('button', { name: /Hoàn tác/ }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('tạo lại cùng nội dung dùng lại kết quả cũ, không sinh asset trùng', async () => {
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()

  // Cùng kịch bản, cùng giọng, cùng tham số -> vân tay yêu cầu trùng.
  await page.getByRole('button', { name: 'Tạo lại' }).click()
  await expect(page.locator('.script-segment__audio')).toBeVisible({ timeout: 120_000 })

  // Thư viện vẫn chỉ có đúng một asset: retry không được chèn bản sao.
  await studio().getByRole('tab', { name: 'Media' }).click()
  await expect(page.locator('.media-card')).toHaveCount(1)
})
