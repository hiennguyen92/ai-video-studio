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
 * Ước lượng độ dài đọc trong tab Giọng đọc.
 *
 * Điều cần chứng minh:
 *
 *   1. con số hiện ra TRƯỚC khi sinh audio — sau đó mới biết thì đã muộn
 *   2. câu dài hơn mức mong muốn bị cảnh báo, kèm số ký tự nên rút còn
 *   3. sửa câu ngắn lại thì cảnh báo tắt, không cần bấm gì thêm
 *   4. giao diện nói rõ con số đang là ước lượng mặc định hay đã hiệu chỉnh
 *
 * Không cần khoá API và không gọi mạng: toàn bộ phần này chạy trước lúc sinh.
 */

let app: ElectronApplication
let page: Page
let userDataDir: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-estimate-'))

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án ước lượng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('tab', { name: 'Giọng đọc' })
    .click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

const panel = (): ReturnType<Page['getByRole']> => page.getByRole('tabpanel', { name: 'Giọng đọc' })

test('độ dài ước tính hiện ngay sau khi chia đoạn, chưa cần sinh audio', async () => {
  await panel()
    .getByLabel('Kịch bản', { exact: true })
    .fill('Gió mạnh mà chạy êm.\n\nGấp nhỏ như cây bút.')
  await panel().getByRole('button', { name: 'Chia thành đoạn' }).click()

  await expect(page.locator('.script-segment')).toHaveCount(2)

  // Mỗi đoạn phải có một con số dạng "≈ 2,4s"; không có thì việc viết kịch bản
  // vẫn phải đoán mò đúng như trước.
  const meta = page.locator('.script-segment__meta')
  await expect(meta.first()).toContainText(/≈ \d+([.,]\d+)?s/)
  await expect(meta.nth(1)).toContainText(/≈ \d+([.,]\d+)?s/)

  await expect(panel().getByText(/Tổng ≈ \d/)).toBeVisible()
})

test('nói rõ đây là ước lượng mặc định khi chưa có câu nào được tạo', async () => {
  // Con số mặc định dựng trên MỘT giọng cụ thể. Không nói ra thì người dùng tin
  // vào một nhịp đọc không phải của giọng mình đang chọn.
  await expect(panel().getByText(/ước lượng mặc định/)).toBeVisible()
})

test('câu dài hơn mức mong muốn bị cảnh báo, kèm số ký tự nên rút còn', async () => {
  await panel().getByLabel('Độ dài mong muốn mỗi câu (giây)').fill('2')

  const first = page.locator('.script-segment').first()
  await first
    .getByLabel('Kịch bản 1')
    .fill('Gió rất mạnh mà máy vẫn chạy êm ru, đủ mát cho cả mặt lẫn cổ khi đi ngoài trời.')

  // Cả con số lẫn lời gợi ý đều mang class cảnh báo — con số đỏ lên là dấu hiệu
  // đọc được nhanh nhất — nên kiểm trên cả dòng meta thay vì trên một thẻ.
  const meta = first.locator('.script-segment__meta')
  await expect(meta).toContainText(/dài hơn 2s/)
  await expect(meta).toContainText(/rút còn ~\d+ ký tự/)
  await expect(first.locator('.script-segment__warning').first()).toContainText(/≈ \d/)
})

test('rút ngắn câu thì cảnh báo tắt ngay, không phải bấm lại gì', async () => {
  const first = page.locator('.script-segment').first()
  await first.getByLabel('Kịch bản 1').fill('Gió mạnh.')

  await expect(first.locator('.script-segment__warning')).toHaveCount(0)
})

test('nới mức mong muốn thì câu dài không còn bị cảnh báo', async () => {
  const first = page.locator('.script-segment').first()
  await first
    .getByLabel('Kịch bản 1')
    .fill('Gió rất mạnh mà máy vẫn chạy êm ru, đủ mát cho cả mặt lẫn cổ.')
  await expect(first.locator('.script-segment__warning').first()).toBeVisible()

  await panel().getByLabel('Độ dài mong muốn mỗi câu (giây)').fill('30')
  await expect(first.locator('.script-segment__warning')).toHaveCount(0)
})

test('câu càng dài thì con số ước tính càng lớn', async () => {
  await panel()
    .getByLabel('Kịch bản', { exact: true })
    .fill('Ngắn.\n\nCâu này dài hơn hẳn câu trên rất nhiều lần.')
  await panel().getByRole('button', { name: 'Chia thành đoạn' }).click()
  await expect(page.locator('.script-segment')).toHaveCount(2)

  const read = async (index: number): Promise<number> => {
    const text = (await page.locator('.script-segment__meta').nth(index).textContent()) ?? ''
    const match = /≈ (\d+([.,]\d+)?)s/.exec(text)
    return Number((match?.[1] ?? '0').replace(',', '.'))
  }

  // Nếu hai con số bằng nhau thì ước lượng không đọc nội dung câu, và cả tính
  // năng này chỉ là một nhãn trang trí.
  expect(await read(1)).toBeGreaterThan(await read(0))
})

/**
 * Phần hiệu chỉnh cần audio THẬT nên chỉ chạy khi bật `AVS_LIVE_EDGE_TTS=1`.
 *
 * Không có nó thì đường hiệu chỉnh chỉ được kiểm ở mức hàm thuần, và việc nối
 * dây từ asset trong dự án sang bộ ước lượng có thể đứt mà không ai biết — con
 * số vẫn hiện, chỉ là mãi mãi dùng mức mặc định.
 */
const live = process.env.AVS_LIVE_EDGE_TTS === '1' ? test : test.skip

live('sinh audio thật xong thì ước lượng chuyển sang hiệu chỉnh', async () => {
  await panel().getByLabel('Nhà cung cấp').selectOption('edge-tts')
  await page.waitForTimeout(1500)
  await panel().getByRole('button', { name: 'Tải danh sách giọng' }).click()
  await page.waitForTimeout(4000)
  await panel().getByLabel('Giọng', { exact: true }).selectOption('vi-VN-HoaiMyNeural')

  // Ba câu DÀI NGẮN KHÁC NHAU: hiệu chỉnh cần độ dốc, mọi câu bằng nhau thì
  // không suy ra được nhịp đọc và giao diện sẽ giữ nguyên mức mặc định.
  await panel()
    .getByLabel('Kịch bản', { exact: true })
    .fill('Mát lắm.\n\nGió mạnh mà chạy rất êm.\n\nGập chân đế xuống là để bàn, rảnh cả hai tay.')
  await panel().getByRole('button', { name: 'Chia thành đoạn' }).click()
  await expect(page.locator('.script-segment')).toHaveCount(3)

  await expect(panel().getByText(/ước lượng mặc định/)).toBeVisible()

  await panel().getByRole('button', { name: 'Tạo audio' }).click()
  await expect(page.locator('.script-segment__audio')).toHaveCount(3, { timeout: 300_000 })

  await expect(panel().getByText(/hiệu chỉnh từ 3 câu đã tạo/)).toBeVisible()

  // Đoạn đã có audio phải hiện số ĐO được, không còn dấu ≈ của ước lượng.
  const meta = page.locator('.script-segment__meta').first()
  await expect(meta).not.toContainText('≈')
  await expect(meta).toContainText(/\d+([.,]\d+)?s/)
})
