import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
 * AI Chat chạy đầu-cuối với MỘT MÁY CHỦ LLM THẬT (dựng tại chỗ).
 *
 * Điều cần chứng minh không phải "chat trả lời được", mà là ba ràng buộc của
 * DESCRIPTION §5:
 *
 *   1. Câu trả lời của mô hình KHÔNG tự sửa dự án — phải qua bản đề xuất.
 *   2. Công cụ bịa ra và id bịa ra bị chặn, kèm lý do đọc được.
 *   3. Dự án đổi giữa chừng thì đề xuất cũ bị từ chối, không ghi đè.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let llmServer: Server
let serverBaseUrl: string
let userDataDir: string
let workDir: string
let mediaPath: string
/** Câu trả lời cho lượt gọi kế tiếp; mỗi phép thử tự đặt. */
let nextReply: unknown = { reply: 'Xin chào', toolCalls: [] }

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-chat-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-chat-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=25:duration=10',
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

  llmServer = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'qwen2.5:7b' }] }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(nextReply) } }] })
      )
    })
  })
  await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve))
  const address = llmServer.address()
  if (address === null || typeof address === 'string') throw new Error('Không mở được máy chủ thử')
  serverBaseUrl = `http://127.0.0.1:${address.port}/v1`

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, mediaPath)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chat')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => llmServer.close(() => resolve()))
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

async function ask(message: string): Promise<void> {
  await page.getByLabel('AI Chat').fill(message)
  await page.getByRole('button', { name: 'Gửi', exact: true }).click()
}

test('chuẩn bị: cấu hình máy chủ LLM và đưa một clip lên timeline', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  const card = page.locator('.provider-card', { hasText: 'Máy chủ LLM (OpenAI-compatible)' })
  await card.locator('input[type="text"]').nth(0).fill(serverBaseUrl)
  await card.locator('input[type="text"]').nth(1).fill('qwen2.5:7b')
  await card.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(page.getByText(/Đã lưu cấu hình cho Máy chủ LLM/)).toBeVisible()

  await studio().getByRole('tab', { name: 'Media' }).click()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('câu hỏi thuần tuý không tạo đề xuất và không đụng vào dự án', async () => {
  nextReply = { reply: 'Dự án của bạn đang có một clip.', toolCalls: [] }

  await page.getByRole('tab', { name: 'AI Chat' }).click()
  await ask('Dự án đang có gì?')

  await expect(page.locator('.chat-message--assistant')).toContainText('một clip')
  await expect(page.locator('.chat-proposal')).toHaveCount(0)
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('đề xuất chỉ được áp dụng khi người dùng bấm — trả lời xong KHÔNG tự sửa', async () => {
  nextReply = {
    reply: 'Mình sẽ cắt clip tại giây thứ 4.',
    toolCalls: [{ name: 'split_clip', arguments: { atSeconds: 4 } }]
  }

  // Chọn clip để "clip đang chọn" có nghĩa.
  await page.locator('.timeline-clip').first().click()
  await page.getByRole('tab', { name: 'AI Chat' }).click()
  await ask('Cắt clip đang chọn tại giây thứ 4')

  await expect(page.locator('.chat-proposal')).toBeVisible()
  await expect(page.locator('.chat-proposal__steps li')).toContainText('Cắt clip tại 4.00s')
  // Chưa bấm áp dụng thì timeline phải nguyên vẹn.
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  await page.locator('.chat-proposal').getByRole('button', { name: 'Áp dụng' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test('một lần hoàn tác trả về đúng trạng thái trước khi AI động vào', async () => {
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('công cụ mô hình bịa ra bị chặn kèm lý do', async () => {
  nextReply = {
    reply: 'Đang xoá toàn bộ dự án.',
    toolCalls: [{ name: 'delete_project', arguments: {} }]
  }

  await page.getByRole('tab', { name: 'AI Chat' }).click()
  await ask('Xoá hết mọi thứ')

  await expect(page.locator('.chat-proposal__failures')).toContainText('delete_project')
  await expect(page.locator('.chat-proposal__failures')).toContainText('Công cụ không tồn tại')
  // Không có bước nào để áp dụng, nên nút phải bị khoá.
  await expect(
    page.locator('.chat-proposal').getByRole('button', { name: 'Áp dụng' })
  ).toBeDisabled()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('id clip bịa ra bị chặn', async () => {
  nextReply = {
    reply: 'Mình cắt clip đó nhé.',
    toolCalls: [{ name: 'split_clip', arguments: { clipId: 'clip_khong_co_that', atSeconds: 2 } }]
  }

  await ask('Cắt clip abc tại giây 2')
  await expect(page.locator('.chat-proposal__failures')).toContainText('Không tìm thấy clip')
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('dự án đổi giữa chừng thì đề xuất cũ bị từ chối', async () => {
  nextReply = {
    reply: 'Mình sẽ cắt tại giây 6.',
    toolCalls: [{ name: 'split_clip', arguments: { atSeconds: 6 } }]
  }

  await page.locator('.timeline-clip').first().click()
  await page.getByRole('tab', { name: 'AI Chat' }).click()
  await ask('Cắt tại giây 6')
  await expect(page.locator('.chat-proposal')).toBeVisible()

  // Sửa dự án SAU khi đã có đề xuất. Phải đưa playhead vào GIỮA clip trước, cắt ở
  // mốc 0 là thao tác rỗng và revision sẽ không đổi.
  const ruler = page.locator('.timeline__ruler-row')
  const rulerBox = await ruler.boundingBox()
  expect(rulerBox).not.toBeNull()
  await page.mouse.click(rulerBox!.x + 180, rulerBox!.y + 12)
  await page.locator('.timeline-clip').first().click()
  await page.getByRole('button', { name: 'Cắt tại playhead' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)

  await expect(page.locator('.chat-proposal')).toContainText('Dự án đã thay đổi')
  await expect(
    page.locator('.chat-proposal').getByRole('button', { name: 'Áp dụng' })
  ).toBeDisabled()
})

test('hội thoại được lưu theo dự án và còn nguyên sau khi mở lại', async () => {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.locator('.project-card__open', { hasText: 'Dự án chat' }).click()

  await page.getByRole('tab', { name: 'AI Chat' }).click()
  await expect(page.locator('.chat-message--user').first()).toContainText('Dự án đang có gì?')
  // Đề xuất KHÔNG được sống lại sau khi mở lại — nó gắn với trạng thái cũ.
  await expect(page.locator('.chat-proposal')).toHaveCount(0)
})
