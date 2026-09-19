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
 * Nhập file phụ đề có sẵn.
 *
 * Trước bản này app chỉ ghi được phụ đề ra file. Phép thử đi trọn vòng: chọn
 * file → cue vào dự án → hiện trên timeline → sống sót qua lưu.
 */

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

const SRT = `1
00:00:01,000 --> 00:00:02,500
Câu đầu tiên

2
00:00:03,000 --> 00:00:05,000
Câu thứ hai
có hai dòng

3
00:00:06,000 --> 00:00:06,000
Khối hỏng: dài bằng không
`

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-srt-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-srt-work-'))
  const srtPath = join(workDir, 'phu-de-co-san.srt')
  await writeFile(srtPath, SRT, 'utf8')

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, srtPath)

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

async function savedSubtitleTracks(): Promise<
  Array<{ name: string; source: { kind: string }; cues: Array<{ startUs: number; text: string }> }>
> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { subtitleTracks: Awaited<ReturnType<typeof savedSubtitleTracks>> }
  return document.subtitleTracks
}

test('nhập được file .srt dù dự án CHƯA phiên âm', async () => {
  // Đây đúng là lúc người dùng có sẵn file phụ đề: chưa có transcript nên form
  // tạo track không giúp được gì.
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()
  await expect(studio().getByText('Chưa có bản phiên âm nào')).toBeVisible()

  await studio().getByRole('button', { name: 'Nhập file phụ đề' }).click()

  const tracks = await savedSubtitleTracks()
  expect(tracks).toHaveLength(1)
  // Tên track lấy từ tên file, bỏ phần đuôi.
  expect(tracks[0].name).toBe('phu-de-co-san')
  expect(tracks[0].source.kind).toBe('imported')
})

test('đọc đúng mốc và chữ, bỏ khối hỏng', async () => {
  const [track] = await savedSubtitleTracks()
  expect(track.cues).toHaveLength(2)
  expect(track.cues[0]).toMatchObject({ startUs: 1_000_000, text: 'Câu đầu tiên' })
  expect(track.cues[1].text).toBe('Câu thứ hai\ncó hai dòng')
})

test('cue hiện thành khối trên timeline', async () => {
  // Phụ đề là DỮ LIỆU trên timeline, không phải một danh sách nằm riêng trong panel.
  await expect(page.locator('.timeline-lane--subtitle .timeline-text-block')).toHaveCount(2)
})

test('phụ đề nhập vào sống sót qua lưu và mở lại', async () => {
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  await expect(page.getByRole('heading', { name: 'AI Video Studio' })).toBeVisible()
  await page.locator('.project-card__open', { hasText: 'Dự án phụ đề' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor({ timeout: 30_000 })

  await expect(page.locator('.timeline-lane--subtitle .timeline-text-block')).toHaveCount(2)
})
