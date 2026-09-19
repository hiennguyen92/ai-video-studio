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
 * Vòng thao tác dựng, chạy thật trong app: sóng âm trên clip hình, chọn nhiều
 * clip bằng kéo khung, dựng bản cut theo lời và theo cảnh bằng nút trên giao diện.
 *
 * Video thử là ba cảnh màu đặc liền nhau (đỏ / vàng / xanh dương, mỗi cảnh
 * 2 s) có tiếng: đủ để dò cú máy ra đúng ba cảnh, và để mốc nguồn của từng clip
 * nói rõ nó lấy từ cảnh nào. Ba màu phải khác hẳn nhau về ĐỘ SÁNG: bộ dò cảnh của
 * ffmpeg chấm theo độ sáng, và đỏ với xanh lá (#008000) sáng gần bằng nhau.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.describe.configure({ mode: 'serial' })

interface SavedClip {
  id: string
  startUs: number
  durationUs: number
  sourceInUs: number
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-edit-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-edit-work-'))
  const video = join(workDir, 'ba-canh.mp4')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    ...['red', 'yellow', 'blue'].flatMap((color) => [
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=320x180:rate=25:duration=2`
    ]),
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=6:sample_rate=48000',
    '-filter_complex',
    '[0][1][2]concat=n=3:v=1:a=0[v]',
    '-map',
    '[v]',
    '-map',
    '3:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    video
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, video)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Vòng dựng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(videoClips()).toHaveCount(1)
  await page.getByRole('button', { name: 'Vừa khung' }).click()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })
const videoClips = (): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip')
const selectedClips = (): ReturnType<Page['locator']> => page.locator('.timeline-clip--selected')

async function documentFile(): Promise<string> {
  const root = join(userDataDir, 'projects')
  const [projectId] = await readdir(root)
  return join(root, projectId, 'project.json')
}

async function savedVideoClips(): Promise<SavedClip[]> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const document = JSON.parse(await readFile(await documentFile(), 'utf8')) as {
    tracks: Array<{ kind: string; clips: SavedClip[] }>
  }
  return [...document.tracks.find((track) => track.kind === 'video')!.clips].sort(
    (a, b) => a.startUs - b.startUs
  )
}

test('clip hình có tiếng hiện sóng âm ở dải dưới', async () => {
  await expect(
    videoClips().first().locator('.timeline-clip__waveform--below-picture')
  ).toBeVisible()
})

test('kéo khung trên vùng trống chọn được nhiều clip; bấm vùng trống thì bỏ chọn', async () => {
  await videoClips()
    .first()
    .click({ position: { x: 30, y: 20 } })
  await page.keyboard.press('Meta+d')
  await expect(videoClips()).toHaveCount(2)
  await page.getByRole('button', { name: 'Vừa khung' }).click()

  const lane = (await page.locator('.timeline-lane--video').boundingBox())!
  const last = (await videoClips().nth(1).boundingBox())!
  const emptyX = last.x + last.width + 30
  expect(emptyX).toBeLessThan(lane.x + lane.width)

  // Bấm vùng trống (không kéo): bỏ chọn.
  await page.mouse.click(emptyX, lane.y + lane.height / 2)
  await expect(selectedClips()).toHaveCount(0)

  // Kéo từ vùng trống sang trái, phủ qua cả hai clip.
  const first = (await videoClips().first().boundingBox())!
  await page.mouse.move(emptyX, lane.y + 4)
  await page.mouse.down()
  await page.mouse.move(first.x + 10, lane.y + lane.height - 4, { steps: 10 })
  await expect(page.locator('.timeline__marquee')).toBeVisible()
  await page.mouse.up()
  await expect(page.locator('.timeline__marquee')).toHaveCount(0)
  await expect(page.locator('.timeline-lane--video .timeline-clip--selected')).toHaveCount(2)
})

test('dựng bản cut theo lời: bỏ dấu đoạn giữa, hai đoạn còn lại xếp liền nhau', async () => {
  // Transcript ghi thẳng vào file dự án như các phép thử phụ đề khác.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()
  const file = await documentFile()
  const document = JSON.parse(await readFile(file, 'utf8'))
  document.transcripts = [
    {
      id: 'tr_cut',
      assetId: document.assets[0].id,
      language: 'vi',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: '2026-01-01T00:00:00.000Z',
      segments: [
        { id: 's1', startUs: 200_000, endUs: 1_800_000, text: 'Câu một', edited: false },
        { id: 's2', startUs: 2_200_000, endUs: 3_800_000, text: 'Câu hỏng', edited: false },
        { id: 's3', startUs: 4_200_000, endUs: 5_800_000, text: 'Câu ba', edited: false }
      ]
    }
  ]
  document.revision += 1
  await writeFile(file, JSON.stringify(document), 'utf8')
  await page.locator('.project-card__open', { hasText: 'Vòng dựng' }).click()
  await expect(videoClips()).toHaveCount(2)

  await studio().getByRole('tab', { name: 'Phiên âm' }).click()
  await studio().getByLabel('Giữ đoạn 2 trong bản cut').uncheck()
  await expect(studio().getByText('Giữ 2/3 đoạn', { exact: false })).toBeVisible()

  page.once('dialog', (prompt) => void prompt.accept())
  await studio().getByRole('button', { name: 'Dựng bản cut từ đoạn đã giữ' }).click()

  const clips = await savedVideoClips()
  expect(clips.map((clip) => [clip.startUs, clip.durationUs, clip.sourceInUs])).toEqual([
    [0, 1_600_000, 200_000],
    [1_600_000, 1_600_000, 4_200_000]
  ])
})

test('dựng theo cảnh: chọn cảnh 3 rồi cảnh 1, xếp đúng thứ tự đã bấm', async () => {
  await studio().getByRole('tab', { name: 'Media' }).click()
  const card = page.locator('.media-card').first()
  await card.hover()
  await card.getByRole('button', { name: 'Dựng theo cảnh' }).click()

  const dialog = page.getByRole('dialog', { name: /Dựng theo cảnh/ })
  const shots = dialog.locator('.shot-cut-dialog__shot')
  await expect(shots).toHaveCount(3, { timeout: 60_000 })
  // Ảnh đại diện của cảnh tải được qua giao thức media.
  await expect
    .poll(() =>
      shots
        .first()
        .locator('img')
        .evaluate((img) => (img as HTMLImageElement).naturalWidth)
    )
    .toBeGreaterThan(0)

  await shots.nth(2).click()
  await shots.nth(0).click()
  await expect(shots.nth(2).locator('.shot-cut-dialog__order')).toHaveText('1')
  await expect(shots.nth(0).locator('.shot-cut-dialog__order')).toHaveText('2')

  page.once('dialog', (prompt) => void prompt.accept())
  await dialog.getByRole('button', { name: 'Dựng lên timeline' }).click()
  await expect(dialog).toHaveCount(0)

  const clips = await savedVideoClips()
  expect(clips).toHaveLength(2)
  // Cảnh xanh dương (4–6 s) trước, rồi cảnh đỏ (0–2 s), liền nhau.
  expect(Math.abs(clips[0].sourceInUs - 4_000_000)).toBeLessThan(100_000)
  expect(clips[1].sourceInUs).toBeLessThan(100_000)
  expect(clips[1].startUs).toBe(clips[0].startUs + clips[0].durationUs)
})
