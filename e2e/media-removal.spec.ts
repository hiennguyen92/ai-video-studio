import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, mkdtemp, rm } from 'node:fs/promises'
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
 * Xoá media khỏi thư viện.
 *
 * Điều cần chứng minh:
 *
 *   1. media KHÔNG dùng ở đâu thì xoá thẳng, và hoàn tác lại được
 *   2. media đang dùng thì hỏi trước, và nói ra số clip sẽ mất theo
 *   3. bấm Huỷ thì KHÔNG mất gì
 *   4. file gốc trên đĩa không bị đụng tới — thư viện là danh sách tham chiếu,
 *      không phải nơi chứa file
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let firstMedia: string
let secondMedia: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-media-rm-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-media-rm-work-'))
  firstMedia = join(workDir, 'canh-mot.mp4')
  secondMedia = join(workDir, 'canh-hai.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  for (const [path, color] of [
    [firstMedia, 'red'],
    [secondMedia, 'blue']
  ]) {
    await execFileAsync(String(ffmpegStatic), [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=320x180:rate=30:duration=4`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      path
    ])
  }

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.a, paths.b] })
    },
    { a: firstMedia, b: secondMedia }
  )

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án xoá media')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await expect(page.locator('.media-card')).toHaveCount(2, { timeout: 90_000 })
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const cardNamed = (name: string): ReturnType<Page['locator']> =>
  page.locator('.media-card').filter({ hasText: name })

test('mỗi media có nút xoá riêng', async () => {
  await expect(cardNamed('canh-mot').getByRole('button', { name: /Xoá canh-mot/ })).toBeAttached()
})

test('media chưa dùng ở đâu thì xoá thẳng, không hỏi', async () => {
  // Không có hộp thoại nào được mở: nếu có, `dialog` handler dưới đây sẽ bắt được
  // và phép thử sẽ thấy biến `asked` bật lên.
  let asked = false
  page.on('dialog', (dialog) => {
    asked = true
    void dialog.accept()
  })

  await cardNamed('canh-hai')
    .getByRole('button', { name: /Xoá canh-hai/ })
    .click()

  await expect(page.locator('.media-card')).toHaveCount(1)
  await expect(cardNamed('canh-hai')).toHaveCount(0)
  expect(asked).toBe(false)

  page.removeAllListeners('dialog')
})

test('hoàn tác đưa media trở lại thư viện', async () => {
  await page.keyboard.press('ControlOrMeta+z')

  await expect(page.locator('.media-card')).toHaveCount(2)
  await expect(cardNamed('canh-hai')).toHaveCount(1)
})

test('media đang dùng thì hỏi trước, và nói ra số clip sẽ mất', async () => {
  await cardNamed('canh-mot').dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  let message = ''
  page.once('dialog', (dialog) => {
    message = dialog.message()
    // Bấm Huỷ: lần này chỉ kiểm lời hỏi, chưa xoá.
    void dialog.dismiss()
  })

  await cardNamed('canh-mot')
    .getByRole('button', { name: /Xoá canh-mot/ })
    .click()
  await expect.poll(() => message).toContain('1 clip')
  // Người dùng phải biết file gốc không bị đụng tới, nếu không họ sẽ không dám bấm.
  expect(message).toContain('File gốc')

  // Huỷ thì KHÔNG mất gì cả.
  await expect(page.locator('.media-card')).toHaveCount(2)
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test('đồng ý thì xoá cả media lẫn clip đang dùng nó', async () => {
  page.once('dialog', (dialog) => {
    void dialog.accept()
  })

  await cardNamed('canh-mot')
    .getByRole('button', { name: /Xoá canh-mot/ })
    .click()

  await expect(cardNamed('canh-mot')).toHaveCount(0)
  await expect(page.locator('.timeline-clip')).toHaveCount(0)
})

test('dọn rác thu hồi file phái sinh của media đã xoá', async () => {
  // Hai media trong dự án này đều là file NHẬP VÀO nên bản thân chúng không nằm
  // trong thư mục dự án. Nhưng thumbnail và waveform sinh ra cho chúng thì có, và
  // sau khi xoá khỏi thư viện thì không ai dùng nữa — đó chính là rác.
  //
  // Một lượt dọn mở HAI hộp thoại: hỏi trước, rồi báo kết quả. Bắt bằng một bộ
  // nghe chung rồi soi cả chuỗi, chứ dùng `once` cho từng cái thì hộp thoại thứ
  // hai của lượt trước sẽ rơi nhầm vào tay lượt sau.
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.accept()
  })

  const cleanup = page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Dọn file rác' })

  await cleanup.click()
  await expect.poll(() => messages.length).toBe(2)
  expect(messages[0]).toMatch(/Dọn \d+ file/)
  // Lời hỏi phải nói rõ file nhập vào không bị đụng tới, nếu không chẳng ai dám bấm.
  expect(messages[0]).toContain('File bạn nhập vào không bị đụng tới')
  expect(messages[1]).toMatch(/Đã dọn \d+ file/)

  // Lần hai phải báo đã sạch. Nếu vẫn "đã dọn N file" thì lần đầu chưa xoá thật.
  await cleanup.click()
  await expect.poll(() => messages.length).toBe(3)
  expect(messages[2]).toContain('Không có file rác')

  page.removeAllListeners('dialog')
})

test('file gốc trên đĩa vẫn còn nguyên', async () => {
  // Thư viện là danh sách THAM CHIẾU. Xoá khỏi thư viện mà mất file gốc thì đó là
  // phá dữ liệu người dùng, và DESCRIPTION §7 cấm đụng tới file nguồn.
  await expect(access(firstMedia)).resolves.toBeUndefined()
  await expect(access(secondMedia)).resolves.toBeUndefined()
})

test('khu Media nhận file kéo thả, và thả lạc chỗ không làm mất phiên dựng', async () => {
  // Mặc định của Chromium khi thả file vào trang là MỞ chính file đó, tức thay
  // luôn trang đang chạy: người dùng mất sạch phiên dựng mà không có lời nào.
  const urlTruoc = page.url()
  const panel = page.locator('.media-library')

  const drag = async (event: string, types: string[]): Promise<void> => {
    await page.evaluate(
      ({ event, types }) => {
        const data = new DataTransfer()
        for (const type of types) {
          if (type === 'Files') data.items.add(new File(['x'], 'keo.mp4', { type: 'video/mp4' }))
          else data.setData(type, '{}')
        }
        document
          .querySelector('.media-library')
          ?.dispatchEvent(new DragEvent(event, { dataTransfer: data, bubbles: true }))
      },
      { event, types }
    )
  }

  await drag('dragenter', ['Files'])
  await expect(panel).toHaveClass(/media-library--dropping/)
  await expect(page.locator('.media-library__dropzone')).toBeVisible()

  await drag('dragleave', ['Files'])
  await expect(panel).not.toHaveClass(/media-library--dropping/)

  // Kéo thẻ trong chính ứng dụng không phải là nhập media; sáng lên là mời người
  // dùng thả một thứ khu này không nhập được.
  await drag('dragenter', ['application/x-ai-video-studio-transition'])
  await expect(panel).not.toHaveClass(/media-library--dropping/)

  // Thả ra ngoài vùng nhận: không điều hướng, không mất gì.
  await page.evaluate(() => {
    const data = new DataTransfer()
    data.items.add(new File(['x'], 'lac.mp4', { type: 'video/mp4' }))
    document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }))
  })
  await page.waitForTimeout(800)
  expect(page.url()).toBe(urlTruoc)
  await expect(page.getByRole('region', { name: 'Timeline' })).toBeVisible()
})
