import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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
 * Âm lượng của cả LANE.
 *
 * Mô hình và cả hai đường dựng đã nhân `track.volume` vào từ lâu, nhưng đầu lane
 * chưa từng có ô chỉnh — nên nó luôn bằng 1 trừ khi agent sửa. Phép thử đi tới
 * tận file xuất ra: một ô chỉnh ghi đúng vào tài liệu mà bản dựng bỏ qua thì
 * cũng vô dụng như không có.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-vol-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-vol-work-'))
  const mediaPath = join(workDir, 'tieng.wav')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  // Sóng sin biên độ cố định: mức ra chỉ có thể đổi vì âm lượng, không vì nội dung.
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4:sample_rate=48000',
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
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output })
    },
    { media: mediaPath, output: outputPath }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án âm lượng')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-lane--audio .timeline-clip')).toHaveCount(1)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

/**
 * Mức âm lượng của MỌI lane tiếng.
 *
 * Dự án mới có nhiều hơn một lane tiếng, nên "lane tiếng đầu tiên" không phải
 * lane mình vừa kéo — lấy nhầm là phép thử đỏ trong khi chức năng chạy đúng.
 */
async function savedAudioVolumes(): Promise<number[]> {
  return (await savedTrackVolumes())
    .filter((track) => track.kind === 'audio')
    .map((track) => track.volume)
}

async function savedTrackVolumes(): Promise<Array<{ kind: string; volume: number }>> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { tracks: Array<{ kind: string; volume: number }> }
  return document.tracks
}

test('lane có tiếng thì có thanh âm lượng, lane không có tiếng thì không', async () => {
  // Bày một thanh trượt không tác động tới gì trên lane phụ đề là một câu hỏi thừa.
  const sliders = page.locator('.track-head__volume')
  const count = await sliders.count()
  expect(count).toBeGreaterThan(0)

  const kinds = await page.evaluate(() =>
    [...document.querySelectorAll('.timeline__heads .track-head')].map((head, index) => ({
      index,
      hasVolume: head.querySelector('.track-head__volume') !== null
    }))
  )
  // Số lane có thanh âm lượng đúng bằng số lane hình + lane tiếng trong dự án mới.
  expect(kinds.filter((item) => item.hasVolume).length).toBe(count)
})

test('kéo thanh ghi đúng MỘT bước hoàn tác', async () => {
  // Mọi lane tiếng bắt đầu ở mức nguyên.
  expect(await savedAudioVolumes()).toEqual([1, 1])

  const slider = page.locator('.track-head__volume').last()
  await slider.fill('0.4')
  // `fill` đặt giá trị rồi bắn sự kiện; rời khỏi ô để chốt như khi thả chuột.
  await slider.blur()

  await expect.poll(savedAudioVolumes).toEqual([1, 0.4])

  // Đúng MỘT lần hoàn tác đưa mức về như cũ: kéo thanh không được đẻ ra hàng
  // chục bước cho một lần chỉnh.
  await page.getByRole('button', { name: /Hoàn tác: Âm lượng lane/ }).click()
  await expect.poll(savedAudioVolumes).toEqual([1, 1])
})

test('mức lane đi tới FILE XUẤT RA, không chỉ nằm trong tài liệu', async () => {
  const slider = page.locator('.track-head__volume').last()
  await slider.fill('0.25')
  await slider.blur()
  await expect.poll(savedAudioVolumes).toEqual([1, 0.25])

  await page.getByRole('button', { name: 'Xuất video' }).click()
  await page.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await page.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(page.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stderr } = await execFileAsync(
    String(ffmpegStatic),
    ['-hide_banner', '-i', outputPath, '-filter:a', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' }
  ).catch((error: { stderr: string }) => ({ stderr: error.stderr }))

  const peak = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr)
  expect(peak).not.toBeNull()
  // Hạ xuống 25% là khoảng −12 dB so với nguyên mức. Sóng sin đầy thang ra
  // khoảng −0,3 dB, nên sau khi hạ phải nằm dưới −6 dB — ngưỡng rộng để không
  // phụ thuộc chi tiết bộ mã hoá, nhưng đủ chặt để bắt được trường hợp mức lane
  // bị bỏ qua hoàn toàn.
  expect(Number(peak![1])).toBeLessThan(-6)
  // Và vẫn phải NGHE ĐƯỢC: hạ âm lượng không phải là tắt tiếng.
  expect(Number(peak![1])).toBeGreaterThan(-40)
})

/** Các mốc keyframe âm lượng đã lưu của clip tiếng. */
async function savedVolumeKeyframes(): Promise<Array<{ atUs: number; v: number }>> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    tracks: Array<{
      kind: string
      clips: Array<{ keyframes?: Record<string, Array<{ atUs: number; v: number }>> }>
    }>
  }
  const clip = document.tracks
    .filter((track) => track.kind === 'audio')
    .flatMap((track) => track.clips)[0]
  return clip?.keyframes?.['volume'] ?? []
}

/** Mức trung bình (dB) của một đoạn trong file đã xuất. */
async function meanVolumeBetween(fromSeconds: number, toSeconds: number): Promise<number> {
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const { stderr } = await execFileAsync(
    String(ffmpegStatic),
    [
      '-hide_banner',
      '-i',
      outputPath,
      '-af',
      `atrim=${fromSeconds}:${toSeconds},volumedetect`,
      '-f',
      'null',
      '-'
    ],
    { encoding: 'utf8' }
  ).catch((error: { stderr: string }) => ({ stderr: error.stderr }))

  const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(stderr)
  expect(
    mean,
    `không đọc được mean_volume trong khoảng ${fromSeconds}..${toSeconds}s`
  ).not.toBeNull()
  return Number(mean![1])
}

/**
 * Keyframe âm lượng: tiếng phải NHỎ DẦN trong chính file xuất ra.
 *
 * Đây là thứ phân biệt keyframe âm lượng thật với một cặp số nằm trong
 * project.json: cả hai đường dựng đều nhân âm lượng vào từ lâu, nhưng nhân một
 * HẰNG SỐ. Đo hai đầu đoạn dốc là cách duy nhất chứng minh giá trị đổi theo
 * từng khung hình.
 */
test('âm lượng chạy keyframe thì file xuất ra nhỏ dần', async () => {
  // Phép thử trước dừng ngay sau khi xuất xong, hộp thoại Xuất vẫn đang che timeline.
  await page
    .getByRole('dialog', { name: 'Xuất video' })
    .getByRole('button', { name: 'Đóng' })
    .click()

  // Trả mức lane về nguyên để phép đo chỉ còn phản ánh đường keyframe của clip.
  const laneVolume = page.locator('.track-head__volume').last()
  await laneVolume.fill('1')
  await laneVolume.blur()
  await expect.poll(savedAudioVolumes).toEqual([1, 1])

  const clip = page.locator('.timeline-lane--audio .timeline-clip').first()
  await clip.click()
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await inspector.getByRole('tab', { name: 'Audio', exact: true }).click()

  const ruler = (await page.locator('.timeline__ruler-row').boundingBox())!
  const clipBox = (await clip.boundingBox())!
  const seekInClip = async (ratio: number): Promise<void> => {
    await page.mouse.click(clipBox.x + clipBox.width * ratio, ruler.y + 12)
    await page.waitForTimeout(400)
  }

  // Mốc đầu giữ nguyên mức, mốc cuối hạ gần hết: một đoạn dốc chạy suốt clip.
  await seekInClip(0.1)
  await inspector.getByRole('button', { name: /Âm lượng/ }).click()
  await seekInClip(0.9)
  await inspector.getByRole('slider', { name: 'Âm lượng' }).fill('0.1')

  await expect.poll(async () => (await savedVolumeKeyframes()).length).toBe(2)
  const keyframes = await savedVolumeKeyframes()
  expect(keyframes[0].v).toBeCloseTo(1, 2)
  expect(keyframes[1].v).toBeCloseTo(0.1, 2)

  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  // Nhánh ffmpeg đọc âm lượng dạng hằng số, nên dự án có keyframe phải đi Remotion.
  await expect(dialog.getByLabel('Bộ dựng hình')).toHaveValue('remotion')
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(page.getByText('Xuất xong')).toBeVisible({ timeout: 240_000 })

  const early = await meanVolumeBetween(0, 1)
  const late = await meanVolumeBetween(3, 4)
  // Hạ từ 100% xuống 10% là khoảng −20 dB. Đòi ÍT NHẤT 8 dB chênh lệch: đủ rộng
  // để không phụ thuộc chi tiết bộ mã hoá, nhưng một bản dựng bỏ qua keyframe sẽ
  // cho hai đoạn gần như bằng nhau và trượt ngay.
  expect(early - late).toBeGreaterThan(8)
})
