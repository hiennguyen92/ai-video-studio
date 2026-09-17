import { createServer, type Server } from 'node:http'
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
 * Lồng tiếng khi audio DÀI HƠN khoảng thời gian gốc.
 *
 * Đây là phép thử cho quy tắc cứng của đề bài: không bao giờ tự cắt mất lời nói
 * để ép cho khớp thời gian.
 *
 * Máy chủ TTS thật ở đây cố tình trả về audio dài 4 giây cho một đoạn chỉ có 2
 * giây. Ứng dụng phải phát hiện ra bằng thời lượng ĐO ĐƯỢC, báo cho người dùng,
 * và đưa ra đúng những lối thoát dùng được — trong đó không có "cắt bớt".
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let ttsServer: Server
let serverBaseUrl: string
let userDataDir: string
let workDir: string
let longWav: Buffer

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-dub-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-dub-work-'))

  // Audio THẬT dài 4 giây — gấp đôi khoảng gốc 2 giây, nên chắc chắn tràn và
  // vượt luôn trần tăng tốc 1,3x.
  const wavPath = join(workDir, 'long-tieng.wav')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=4:sample_rate=24000',
    '-ac',
    '1',
    wavPath
  ])
  longWav = await readFile(wavPath)

  ttsServer = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      if (request.url?.endsWith('/models')) {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'test-voice-model' }] }))
        return
      }
      response.writeHead(200, { 'Content-Type': 'audio/wav' })
      response.end(longWav)
    })
  })
  await new Promise<void>((resolve) => ttsServer.listen(0, '127.0.0.1', resolve))
  const address = ttsServer.address()
  if (address === null || typeof address === 'string') throw new Error('Không mở được máy chủ thử')
  serverBaseUrl = `http://127.0.0.1:${address.port}/v1`

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án lồng tiếng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  await new Promise<void>((resolve) => ttsServer.close(() => resolve()))
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

/**
 * Ghi sẵn transcript và bản dịch vào project.json.
 *
 * Đoạn gốc dài đúng 2 giây, còn máy chủ luôn trả audio 4 giây — chênh lệch được
 * dựng có chủ ý để chạm vào nhánh tràn giờ.
 */
async function seedTranscriptAndTranslation(): Promise<void> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')

  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    transcripts: unknown[]
    translations: unknown[]
    revision: number
  }

  document.transcripts = [
    {
      id: 'tr_dub',
      assetId: 'asset_dub',
      language: 'en',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: new Date().toISOString(),
      segments: [{ id: 'seg_1', startUs: 0, endUs: 2_000_000, text: 'A short line', edited: false }]
    }
  ]
  document.translations = [
    {
      id: 'tl_dub',
      transcriptId: 'tr_dub',
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      providerId: 'openai-compatible-chat',
      model: 'qwen',
      createdAt: new Date().toISOString(),
      glossary: [],
      segments: [
        {
          id: 'd1',
          sourceSegmentId: 'seg_1',
          text: 'Một câu tiếng Việt dài hơn hẳn bản gốc',
          edited: false
        }
      ]
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')
}

test('cấu hình máy chủ TTS tự host', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio().getByRole('tab', { name: 'Voice', exact: true }).click()

  const card = page.locator('.provider-card', { hasText: 'Máy chủ tự host (OpenAI-compatible)' })
  await card.locator('input[type="text"]').nth(0).fill(serverBaseUrl)
  await card.locator('input[type="text"]').nth(1).fill('test-voice-model')
  await card.locator('input[type="text"]').nth(2).fill('gio-doc-thu')
  await card.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(page.getByText(/Đã lưu cấu hình cho Máy chủ tự host/)).toBeVisible()
})

test('nạp bản dịch rồi chuẩn bị lồng tiếng', async () => {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await seedTranscriptAndTranslation()
  await page.locator('.project-card__open', { hasText: 'Dự án lồng tiếng' }).click()

  await studio().getByRole('tab', { name: 'Giọng đọc' }).click()
  await page.getByLabel('Nhà cung cấp').selectOption('self-hosted-openai')
  await page.getByRole('button', { name: /Tải danh sách giọng|Đang tải giọng/ }).click()
  await expect(page.getByLabel('Giọng', { exact: true })).toBeEnabled({ timeout: 30_000 })

  await page.getByRole('button', { name: 'Chuẩn bị lồng tiếng' }).click()
  await expect(page.locator('.dubbing-row')).toHaveCount(1)
  // Khoảng gốc đúng 2 giây.
  await expect(page.locator('.dubbing-row')).toContainText('00:02')
})

test('audio dài hơn khoảng gốc được PHÁT HIỆN bằng thời lượng đo được', async () => {
  await page.getByRole('button', { name: 'Đọc tất cả các đoạn' }).click()

  const row = page.locator('.dubbing-row')
  await expect(row).toHaveClass(/dubbing-row--overflow/, { timeout: 60_000 })
  await expect(row).toContainText('Đã có audio')
  // 4 giây thật, không phải con số ước lượng theo số ký tự.
  await expect(row).toContainText('Đo được')
  await expect(row).toContainText('Dài hơn')
})

test('không bao giờ đề nghị cắt bớt lời; tăng tốc quá trần bị loại', async () => {
  const row = page.locator('.dubbing-row')

  // Cần 2x nhưng trần là 1,3x, nên nút tăng tốc phải KHÔNG có, kèm giải thích.
  await expect(row.getByRole('button', { name: /Tăng tốc/ })).toHaveCount(0)
  await expect(row).toContainText('vượt giới hạn')

  // Hai lối thoát còn lại phải sẵn sàng.
  await expect(row.getByRole('button', { name: 'Rút ngắn lời rồi đọc lại' })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Kéo dài timeline' })).toBeVisible()

  // Và tuyệt đối không có lựa chọn nào cắt bớt lời nói.
  await expect(page.locator('.dubbing-panel')).not.toContainText('Cắt')
  await expect(page.locator('.dubbing-panel')).toContainText('không bao giờ bị cắt')
})

test('chọn kéo dài timeline thì clip giữ ĐÚNG độ dài audio thật', async () => {
  await page.getByRole('button', { name: 'Kéo dài timeline' }).click()
  await expect(page.locator('.dubbing-panel')).toContainText('Timeline dài thêm')

  await page.getByRole('button', { name: 'Đưa lên timeline' }).click()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  // Đọc thẳng dữ liệu dự án: đây mới là bằng chứng không thể chối cãi rằng lời
  // nói không bị cắt. Đoạn gốc dài 2 giây, audio thật 4 giây → clip phải là 4
  // giây. Nếu ứng dụng lén ép cho vừa, con số này sẽ là 2 giây.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const saved = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    tracks: Array<{ clips: Array<{ durationUs: number }> }>
  }

  const clips = saved.tracks.flatMap((track) => track.clips)
  expect(clips).toHaveLength(1)
  // WAV 4 giây; cho phép lệch vài mili giây do đóng gói.
  expect(clips[0].durationUs).toBeGreaterThan(3_900_000)
  expect(clips[0].durationUs).toBeLessThan(4_100_000)
})
