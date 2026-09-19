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
 * Phát xem trước có tiếng thì tiếng KHÔNG bị kéo lùi giữa chừng.
 *
 * Lỗi đã gặp: mỗi khung khi đang phát, đầu phát được đẩy lên store và cả giao
 * diện (timeline, panel chứa Player, chat…) vẽ lại. Luồng chính bận tới mức Player
 * tụt khung, hình chạy chậm hơn tiếng, và Remotion tua tiếng lùi ~0,7 giây cho
 * khớp — người dùng nghe như âm thanh bị lặp.
 *
 * Đo bằng sự kiện `seeking` của chính thẻ `<audio>`/`<video>`: đang phát mà có
 * `seeking` là có một cú tua, và tai nghe thấy đúng cú tua đó.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-sync-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-sync-work-'))
  const video = join(workDir, 'canh.mp4')
  const tone = join(workDir, 'nhac.mp3')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const ffmpeg = String(ffmpegStatic)
  await execFileAsync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=10',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    video
  ])
  await execFileAsync(ffmpeg, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=10',
    '-b:a',
    '96k',
    tone
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
    },
    [video, tone]
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án phát thử')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 90_000 })
  await page.locator('.media-card').nth(0).dblclick()
  await page.locator('.media-card').nth(1).dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

test('đang phát thì tiếng và hình không bị tua lùi giữa chừng', async () => {
  await page.evaluate(() => {
    const log: Array<{ tag: string; to: number }> = []
    ;(window as unknown as { __seeks: typeof log }).__seeks = log
    document.addEventListener(
      'seeking',
      (event) => {
        const media = event.target as HTMLMediaElement
        log.push({ tag: media.tagName, to: media.currentTime })
      },
      true
    )
  })

  await page.getByRole('button', { name: 'Phát', exact: true }).click()
  // Trước khi sửa, cú tua lùi đầu tiên rơi vào khoảng giây thứ 3.
  await page.waitForTimeout(4_500)
  const whilePlaying = await page.evaluate(
    () => (window as unknown as { __seeks: Array<{ tag: string; to: number }> }).__seeks
  )
  await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click()

  expect(whilePlaying).toEqual([])
})
