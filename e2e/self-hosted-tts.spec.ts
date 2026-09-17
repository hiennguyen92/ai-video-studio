import { createServer, type Server } from 'node:http'
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
 * Kiểm thử đầu-cuối provider TỰ HOST.
 *
 * Dựng một máy chủ HTTP thật nói giao thức `POST /v1/audio/speech` kiểu OpenAI —
 * đúng giao thức mà omnivoice-server, Piper HTTP server, openedai-speech, Coqui
 * XTTS và Kokoro FastAPI đều dùng — rồi cho ứng dụng gọi vào đó.
 *
 * Audio trả về là file WAV THẬT do ffmpeg sinh, nên đường đi đầy đủ được kiểm
 * chứng: gọi HTTP → ghi file → ffprobe đo thời lượng → asset vào thư viện → clip
 * trên timeline.
 *
 * ⚠️ Máy chủ ở đây là bản dựng cho kiểm thử, KHÔNG phải omnivoice-server thật.
 * Nó khẳng định adapter nói đúng giao thức, không khẳng định omnivoice-server
 * hành xử đúng như tài liệu của nó.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let ttsServer: Server
let serverBaseUrl: string
let userDataDir: string
let workDir: string
let sampleWav: Buffer
const requests: Array<{ path: string; body: string }> = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-selfhost-profile-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-selfhost-work-'))

  // Audio thật để ffprobe đo được thời lượng, thay vì vài byte giả.
  const wavPath = join(workDir, 'giong-doc.wav')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=3:sample_rate=24000',
    '-ac',
    '1',
    wavPath
  ])
  const { readFile } = await import('node:fs/promises')
  sampleWav = await readFile(wavPath)

  ttsServer = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({ path: request.url ?? '', body })

      if (request.url?.startsWith('/v1/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'omnivoice' }] }))
        return
      }
      if (request.url?.startsWith('/v1/audio/voices')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ voices: ['vi-nu', 'vi-nam'] }))
        return
      }
      if (request.url?.startsWith('/v1/audio/speech')) {
        response.writeHead(200, { 'content-type': 'audio/wav' })
        response.end(sampleWav)
        return
      }
      response.writeHead(404, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'not found' }))
    })
  })
  await new Promise<void>((resolve) => ttsServer.listen(0, '127.0.0.1', resolve))
  const address = ttsServer.address()
  if (!address || typeof address === 'string') throw new Error('Không lấy được cổng máy chủ')
  serverBaseUrl = `http://127.0.0.1:${address.port}/v1`

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Tự host')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => ttsServer?.close(() => resolve()))
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('provider tự host không đòi khoá API', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio().getByRole('tab', { name: 'Voice', exact: true }).click()

  // Giới hạn trong thẻ của chính provider này: provider chạy local khác cũng có
  // huy hiệu y hệt.
  const card = page.locator('.provider-card', { hasText: 'Máy chủ tự host (OpenAI-compatible)' })
  await expect(card).toBeVisible()
  // Không bắt buộc khoá thì huy hiệu phải nói vậy, không phải "Chưa có khoá".
  await expect(card.getByText('Không bắt buộc khoá')).toBeVisible()
  // Ô địa chỉ máy chủ được dựng từ khai báo của provider.
  await expect(card.getByText('Địa chỉ máy chủ *')).toBeVisible()
})

test('lưu địa chỉ máy chủ và kiểm tra kết nối thành công', async () => {
  const card = page.locator('.provider-card', { hasText: 'Máy chủ tự host' })
  await card.locator('input[type="text"]').first().fill(serverBaseUrl)

  await card.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(
    page.getByText('Đã lưu cấu hình cho Máy chủ tự host (OpenAI-compatible)')
  ).toBeVisible()

  await card.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
  await expect(card.locator('.provider-card__test')).toContainText('Kết nối được', {
    timeout: 30_000
  })
})

test('tải giọng từ máy chủ tự host mà không cần khoá', async () => {
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()
  await page.getByLabel('Nhà cung cấp').selectOption('self-hosted-openai')

  // Không bắt buộc khoá nên không được hiện cảnh báo thiếu khoá.
  await expect(page.getByText('Chưa có khoá API cho nhà cung cấp này.')).toHaveCount(0)

  await page.getByRole('button', { name: /Tải danh sách giọng|Đang tải giọng/ }).click()

  const voiceSelect = page.getByLabel('Giọng', { exact: true })
  await expect(voiceSelect).toBeEnabled({ timeout: 30_000 })
  await expect(voiceSelect.locator('option')).toHaveCount(2)
})

test('sinh giọng đọc qua máy chủ tự host thành asset và clip thật', async () => {
  await page.getByLabel('Kịch bản', { exact: true }).fill('Xin chào từ máy chủ tự host.')
  await page.getByRole('button', { name: 'Chia thành đoạn' }).click()
  await page.getByRole('button', { name: 'Tạo đoạn này' }).click()

  await expect(page.locator('.script-segment__audio')).toBeVisible({ timeout: 60_000 })

  // Máy chủ phải nhận đúng hình dạng yêu cầu OpenAI.
  const speechRequest = requests.find((entry) => entry.path.startsWith('/v1/audio/speech'))
  expect(speechRequest).toBeDefined()
  const body = JSON.parse(speechRequest!.body) as Record<string, unknown>
  expect(body.input).toBe('Xin chào từ máy chủ tự host.')
  expect(body.model).toBe('omnivoice')
  expect(body.voice).toBe('vi-nu')

  // Asset vào thư viện với thời lượng ĐO ĐƯỢC từ file WAV thật (3 giây).
  await studio().getByRole('tab', { name: 'Media' }).click()
  await expect(page.locator('.media-card')).toHaveCount(1)
  await expect(page.locator('.media-card__duration')).toHaveText('00:00:03')

  // Và chèn được lên timeline như mọi audio khác.
  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()
  await page.getByRole('button', { name: 'Chèn tại playhead' }).last().click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('máy chủ tắt thì báo lỗi rõ ràng thay vì treo', async () => {
  await new Promise<void>((resolve) => ttsServer.close(() => resolve()))

  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio().getByRole('tab', { name: 'Voice', exact: true }).click()
  await page
    .locator('.provider-card', { hasText: 'Máy chủ tự host' })
    .getByRole('button', { name: 'Kiểm tra kết nối' })
    .click()

  await expect(page.getByText('Không kết nối được')).toBeVisible({ timeout: 30_000 })
})
