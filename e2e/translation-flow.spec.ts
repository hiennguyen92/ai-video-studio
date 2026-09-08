import { createServer, type Server } from 'node:http'
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
 * Luồng dịch chạy đầu-cuối trong ứng dụng thật, nói chuyện với một MÁY CHỦ HTTP
 * THẬT theo giao thức OpenAI chat.
 *
 * Máy chủ ở đây trả lời theo kịch bản dựng sẵn để tái hiện đúng kiểu lỗi mà mô
 * hình ngôn ngữ hay mắc (bỏ sót đoạn cuối). Nó chứng minh: giao thức đúng, liên
 * kết đoạn không đứt, sửa tay được, dữ liệu sống qua lưu — KHÔNG chứng minh chất
 * lượng dịch của một mô hình cụ thể.
 */

let app: ElectronApplication
let page: Page
let server: Server
let serverBaseUrl: string
let userDataDir: string
let requestCount = 0
/** Prompt của lượt gọi gần nhất, để khẳng định thứ ứng dụng THẬT SỰ gửi đi. */
let lastPrompt = ''

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'qwen2.5:7b' }] }))
        return
      }

      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
        messages?: Array<{ content?: string }>
      }
      const prompt = body.messages?.map((message) => message.content ?? '').join('\n') ?? ''
      lastPrompt = prompt
      // Lấy đúng những id máy chủ được hỏi, để trả lời bám theo yêu cầu thật.
      const ids = [...prompt.matchAll(/"id":"(seg_[^"]+)"/g)].map((match) => match[1])

      requestCount += 1
      // Lượt đầu cố tình bỏ sót đoạn cuối — ứng dụng phải tự hỏi lại.
      const answered = requestCount === 1 && ids.length > 1 ? ids.slice(0, -1) : ids

      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  segments: answered.map((id, index) => ({
                    id,
                    text: `Bản dịch số ${index + 1}`
                  }))
                })
              }
            }
          ]
        })
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Không mở được máy chủ thử')
  serverBaseUrl = `http://127.0.0.1:${address.port}/v1`

  userDataDir = await mkdtemp(join(tmpdir(), 'avs-translate-'))
  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án dịch')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

/**
 * Đặt sẵn một transcript vào project bằng cách sửa THẲNG file project.json rồi
 * mở lại dự án.
 *
 * Không dựng cửa hậu nào trong mã sản phẩm chỉ để phục vụ kiểm thử. Cách này
 * còn kiểm luôn được một thứ đáng giá: transcript phải nạp lại đúng từ đĩa.
 * Phải rời khỏi dự án trước khi ghi, nếu không autosave sẽ đè mất.
 */
async function seedTranscriptOnDisk(): Promise<void> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')

  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    transcripts: unknown[]
    revision: number
  }
  document.transcripts = [
    {
      id: 'tr_e2e',
      assetId: 'asset_e2e',
      language: 'en',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml-base.en.bin',
      createdAt: new Date().toISOString(),
      segments: [
        { id: 'seg_1', startUs: 0, endUs: 1_000_000, text: 'Hello there', edited: false },
        {
          id: 'seg_2',
          startUs: 1_000_000,
          endUs: 2_000_000,
          text: 'Drag it to the timeline',
          edited: false
        },
        { id: 'seg_3', startUs: 2_000_000, endUs: 3_000_000, text: 'That is all', edited: false }
      ]
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')
}

test('tab Dịch nói rõ chưa có gì để dịch', async () => {
  await studio().getByRole('tab', { name: 'Dịch' }).click()
  await expect(page.getByText('Chưa có bản phiên âm nào để dịch.')).toBeVisible()
})

test('trỏ tới máy chủ LLM và kiểm tra kết nối', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()

  const card = page.locator('.provider-card', { hasText: 'Máy chủ LLM (OpenAI-compatible)' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Không bắt buộc khoá')).toBeVisible()

  await card.locator('input[type="text"]').nth(0).fill(serverBaseUrl)
  await card.locator('input[type="text"]').nth(1).fill('qwen2.5:7b')
  await card.getByRole('button', { name: 'Lưu cấu hình' }).click()

  await card.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  await expect(card.locator('.provider-card__test')).toContainText('Kết nối được', {
    timeout: 30_000
  })
})

test('dịch giữ đủ đoạn dù mô hình bỏ sót ở lượt đầu', async () => {
  // Rời khỏi dự án để autosave không đè lên transcript vừa ghi.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await seedTranscriptOnDisk()
  await page.locator('.project-card__open', { hasText: 'Dự án dịch' }).click()

  await studio().getByRole('tab', { name: 'Dịch' }).click()

  await page.getByLabel('Bản phiên âm').waitFor()
  await page.getByRole('button', { name: 'Bắt đầu dịch' }).click()

  const rows = page.locator('.translate-row')
  await expect(rows).toHaveCount(3, { timeout: 60_000 })

  // Bất biến quan trọng nhất: đoạn bị bỏ sót ở lượt đầu vẫn phải được DỊCH, chứ
  // không phải chỉ được điền lại bằng chính lời gốc. Kiểm "khác rỗng" là chưa đủ:
  // cơ chế dự phòng giữ nguyên bản gốc cũng cho ra ô khác rỗng.
  await expect(rows.nth(2).locator('textarea')).toHaveValue(/Bản dịch/)
  await expect(rows.nth(0).locator('textarea')).toHaveValue(/Bản dịch/)
  // Có đúng hai lượt gọi: lượt đầu và lượt hỏi lại đoạn thiếu.
  expect(requestCount).toBe(2)

  // Cột trái vẫn là lời gốc, đúng thứ tự của transcript.
  await expect(rows.nth(0)).toContainText('Hello there')
  await expect(rows.nth(2)).toContainText('That is all')
})

test('sửa một đoạn dịch được đánh dấu và hoàn tác được', async () => {
  const firstRow = page.locator('.translate-row').first()
  await firstRow.locator('textarea').fill('Xin chào bạn')
  await expect(firstRow.locator('.translate-row__badge')).toHaveText('đã sửa')

  await page.keyboard.press('ControlOrMeta+z')
  await expect(firstRow.locator('textarea')).not.toHaveValue('Xin chào bạn')
})

test('glossary được lưu vào dự án và gửi kèm khi dịch lại', async () => {
  await page.getByRole('button', { name: 'Thêm thuật ngữ' }).click()
  await page.getByLabel('Từ gốc 1').fill('timeline')
  await page.getByLabel('Dịch thành 1').fill('dòng thời gian')

  // Dịch lại: prompt gửi đi phải mang theo thuật ngữ vừa khai.
  lastPrompt = ''
  await page.getByRole('button', { name: 'Dịch lại' }).click()
  await expect(page.locator('.translate-row')).toHaveCount(3)
  await expect.poll(() => lastPrompt).toContain('dòng thời gian')

  // Glossary thuộc về dự án nên phải sống qua lần đóng/mở lại.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await page.locator('.project-card__open', { hasText: 'Dự án dịch' }).click()

  await studio().getByRole('tab', { name: 'Dịch' }).click()
  await expect(page.getByLabel('Từ gốc 1')).toHaveValue('timeline')
  await expect(page.locator('.translate-row')).toHaveCount(3)
})
