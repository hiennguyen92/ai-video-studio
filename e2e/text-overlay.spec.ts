import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, stat } from 'node:fs/promises'
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
 * Chữ đè lên hình, chạy thật trong app.
 *
 * Điều cần chứng minh:
 *
 *   1. chữ HIỆN trên preview đúng khoảng thời gian đã đặt, và biến mất ngoài đó
 *   2. hiệu ứng làm đổi hình (giữ nguyên đầu phát, chỉ đổi kiểu)
 *   3. nó đi được tới file xuất ra, không chỉ sống trong preview
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
let outputPath: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-text-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-text-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')
  outputPath = join(workDir, 'ket-qua.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=gray:size=640x360:rate=30:duration=8',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án chữ')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.timeline-clip')).toHaveCount(1)
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

/**
 * Chữ có THẬT SỰ nhìn thấy được không.
 *
 * `toContainText` không đủ: thẻ vẫn nằm trong DOM với đúng nội dung trong khi
 * `opacity` bằng 0 — đó chính là khung đầu tiên của hiệu ứng vào. Phép thử cũ
 * xanh suốt trong lúc màn hình trống trơn.
 */
async function overlayOpacity(): Promise<number> {
  return Number(
    await page
      .locator('.text-overlay')
      .first()
      .evaluate((node) => getComputedStyle(node).opacity)
  )
}

test('thêm chữ được ngay cả khi chưa có bản phiên âm nào', async () => {
  await studio().getByRole('tab', { name: 'Phụ đề' }).click()

  // Chữ overlay do người dùng tự viết nên không phụ thuộc transcript.
  await expect(page.getByText('Chưa có chữ nào.')).toBeVisible()
  await page.getByRole('button', { name: 'Thêm chữ' }).click()

  await page.getByLabel('Nội dung 1').fill('Bạn đang bỏ lỡ thứ này')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
})

test('chữ overlay hiện thành khối trên lane riêng của timeline', async () => {
  // Chữ overlay nằm ở CẤP TÀI LIỆU, không thuộc track nào, nên timeline vốn
  // không vẽ gì cho nó. Thiếu lane này thì trên timeline không có dấu vết nào
  // của chữ — đúng thứ người dùng báo thiếu.
  const timeline = page.getByRole('region', { name: 'Timeline' })
  await expect(timeline.getByText('Chữ trên hình')).toBeVisible()

  const blocks = page.locator('.timeline-text-block--overlay')
  await expect(blocks).toHaveCount(1)
  await expect(blocks.first()).toContainText('Bạn đang bỏ lỡ thứ này')

  // Khối phải có bề rộng thật, đặt đúng mốc bắt đầu.
  const box = await blocks.first().boundingBox()
  expect(box!.width).toBeGreaterThan(1)
})

test('thêm chữ thứ hai thì lane có hai khối, khối sau nằm bên phải', async () => {
  // Tua đầu phát ra xa TRƯỚC khi thêm: chữ mới bắt đầu ngay tại đầu phát, nên
  // không phải sửa ô giờ nào cả.
  //
  // Sửa ô giờ ở đây từng làm phép thử này ngã theo một cách đáng nhớ: đặt giờ
  // BẮT ĐẦU vượt quá giờ KẾT THÚC hiện tại thì lệnh bị từ chối im lặng, ô nhập
  // bật về giá trị cũ, và chữ nằm nguyên chỗ cũ.
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  await page.mouse.click(box!.x + 350, box!.y + 12)

  await page.getByRole('button', { name: 'Thêm chữ' }).click()
  await page.getByLabel('Nội dung 2').fill('Giỏ hàng bên dưới')

  const blocks = page.locator('.timeline-text-block--overlay')
  await expect(blocks).toHaveCount(2)

  const lefts = await blocks.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().left)
  )
  expect(lefts[1]).toBeGreaterThan(lefts[0])

  // Dọn lại để các phép thử sau vẫn làm việc với đúng một chữ.
  await page.getByRole('button', { name: 'Xoá chữ' }).nth(1).click()
  await expect(blocks).toHaveCount(1)
})

test('bấm vào khối chữ thì tua đầu phát tới đúng chữ đó', async () => {
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()

  // Tua ra ngoài khoảng chữ trước, để lần bấm sau chứng minh được điều gì đó.
  await page.mouse.click(box!.x + 420, box!.y + 12)
  await expect(page.locator('.text-overlay')).toHaveCount(0)

  // Lane chữ nằm cuối cùng, mà thước thời gian dính ở đỉnh vùng cuộn. Panel
  // timeline thấp thì lane cuối rơi ngay dưới thước và không bấm tới được — cuộn
  // xuống đáy trước.
  await page
    .locator('.timeline__scroll')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))

  await page.locator('.timeline-text-block--overlay').first().click()
  await expect(page.locator('.text-overlay')).toContainText('Bạn đang bỏ lỡ thứ này')
  await expect(page.locator('.timeline-text-block--active')).toHaveCount(1)

  // Và phải NHÌN THẤY được. Tua tới đúng mốc bắt đầu là rơi trúng khung mà hiệu
  // ứng vào còn ở opacity 0 — bấm vào một câu để xem nó rồi thấy màn hình trống.
  await expect.poll(overlayOpacity).toBeGreaterThan(0.5)
})

/** Đọc giờ của chữ đầu tiên từ chính file dự án đã lưu. */
async function savedOverlayRange(): Promise<{ startUs: number; endUs: number }> {
  const { readFile, readdir } = await import('node:fs/promises')
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { textOverlays: Array<{ startUs: number; endUs: number }> }
  return document.textOverlays[0]
}

test('kéo cả khối trên timeline thì dời giờ, giữ nguyên độ dài', async () => {
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })

  const before = await savedOverlayRange()
  const block = page.locator('.timeline-text-block--overlay').first()
  const box = (await block.boundingBox())!

  // Bắt vào GIỮA khối, tránh hai tay cầm ở hai mép.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const after = await savedOverlayRange()

  expect(after.startUs).toBeGreaterThan(before.startUs)
  // Dời thì độ dài phải y nguyên; lệch đi nghĩa là đang cắt chứ không phải dời.
  expect(after.endUs - after.startUs).toBe(before.endUs - before.startUs)
})

test('một lần kéo là MỘT bước hoàn tác', async () => {
  const before = await savedOverlayRange()

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const undone = await savedOverlayRange()

  // Kéo sinh hàng trăm sự kiện chuột. Nếu mỗi sự kiện ghi một lệnh thì một lần
  // Ctrl+Z chỉ lùi được một chút xíu, và người dùng phải bấm hàng trăm lần.
  expect(undone.startUs).toBeLessThan(before.startUs)

  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  expect((await savedOverlayRange()).startUs).toBe(before.startUs)
})

test('kéo mép phải chỉ đổi giờ kết thúc', async () => {
  const before = await savedOverlayRange()
  const block = page.locator('.timeline-text-block--overlay').first()
  const box = (await block.boundingBox())!

  await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 100, box.y + box.height / 2, { steps: 12 })
  await page.mouse.up()

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const after = await savedOverlayRange()

  expect(after.startUs).toBe(before.startUs)
  expect(after.endUs).toBeGreaterThan(before.endUs)
})

test('kéo mép trái vượt qua mép phải vẫn để lại một khoảng hợp lệ', async () => {
  const before = await savedOverlayRange()
  const block = page.locator('.timeline-text-block--overlay').first()
  const box = (await block.boundingBox())!

  // Kéo mép trái sang tận bên phải mép phải. Reducer từ chối khoảng ngược một
  // cách IM LẶNG, nên nếu không kẹp thì khối chỉ lặng lẽ bật về chỗ cũ.
  await page.mouse.move(box.x + 3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width + 200, box.y + box.height / 2, { steps: 16 })
  await page.mouse.up()

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const after = await savedOverlayRange()

  expect(after.endUs).toBeGreaterThan(after.startUs)
  expect(after.endUs).toBe(before.endUs)
})

test('ô chọn phông liệt kê phông THẬT của máy, không phải danh sách viết cứng', async () => {
  const select = studio().getByLabel('Phông chữ')
  await expect(select).toBeVisible()

  // Danh sách viết cứng sẽ chứa phông máy không có, và chọn phải nó thì chữ lặng
  // lẽ rơi về phông mặc định. Máy nào cũng có vài chục họ phông.
  const options = await select.locator('option').count()
  expect(options).toBeGreaterThan(20)
})

test('đổi phông làm đổi hình trên preview', async () => {
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByLabel('Hiệu ứng ra 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)

  const stage = page.locator('.preview__stage')
  const before = await stage.screenshot()

  // Phông đẳng khoảng khác hẳn phông mặc định, nên khác biệt nhìn rõ.
  await studio().getByLabel('Phông chữ').selectOption('Courier New')
  await page.waitForTimeout(900)

  expect((await stage.screenshot()).equals(before)).toBe(false)
})

test('chọn phông còn LƯU file phông lại, để bản nung không đổi phông ngầm', async () => {
  const { readFile, readdir, access } = await import('node:fs/promises')

  await expect
    .poll(
      async () => {
        const projectsRoot = join(userDataDir, 'projects')
        const [projectId] = await readdir(projectsRoot)
        const document = JSON.parse(
          await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
        ) as { textOverlays: Array<{ style: { fontFamily: string; fontFilePath?: string } }> }
        return document.textOverlays[0].style
      },
      { timeout: 20_000 }
    )
    .toMatchObject({ fontFamily: 'Courier New' })

  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as { textOverlays: Array<{ style: { fontFilePath?: string } }> }
  const fontFilePath = document.textOverlays[0].style.fontFilePath

  // libass tra phông qua fontconfig và có thể không thấy phông hệ thống; chép hẳn
  // file ra rồi chỉ thẳng cho ffmpeg mới chắc bản nung dùng đúng phông.
  expect(fontFilePath).toBeTruthy()
  await expect(access(fontFilePath as string)).resolves.toBeUndefined()
})

test('chọn được KIỂU trong họ, và đổi kiểu làm đổi hình', async () => {
  // Tên họ chỉ chọn được họ. Đo thật trong Chromium: đặt font-family theo tên đầy
  // đủ ("American Typewriter Bold") cho ra cùng bề rộng với hai kiểu khác — tức
  // là không phân biệt được. Tên PostScript thì phân biệt.
  await studio().getByLabel('Phông chữ').selectOption('American Typewriter')
  await page.waitForTimeout(900)

  const styleSelect = studio().getByLabel('Kiểu chữ')
  await expect(styleSelect).toBeVisible()
  expect(await styleSelect.locator('option').count()).toBeGreaterThan(1)

  const stage = page.locator('.preview__stage')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const before = await stage.screenshot()

  const values = await styleSelect
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value))
  const current = await styleSelect.inputValue()
  await styleSelect.selectOption(values.find((value) => value !== current) as string)
  await page.waitForTimeout(900)

  expect((await stage.screenshot()).equals(before)).toBe(false)
})

test('đổi kiểu lưu lại đúng file phông của KIỂU đó', async () => {
  const { readFile, readdir, access } = await import('node:fs/promises')

  const style = await expect
    .poll(
      async () => {
        const projectsRoot = join(userDataDir, 'projects')
        const [projectId] = await readdir(projectsRoot)
        const document = JSON.parse(
          await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
        ) as {
          textOverlays: Array<{
            style: { fontPostScriptName?: string; fontFilePath?: string }
          }>
        }
        return document.textOverlays[0].style
      },
      { timeout: 20_000 }
    )
    .toMatchObject({ fontPostScriptName: expect.stringContaining('AmericanTypewriter') })
    .then(async () => {
      const projectsRoot = join(userDataDir, 'projects')
      const [projectId] = await readdir(projectsRoot)
      const document = JSON.parse(
        await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
      ) as { textOverlays: Array<{ style: { fontFilePath?: string } }> }
      return document.textOverlays[0].style
    })

  // Lấy nhầm kiểu khác thì bản nung trông khác preview mà không có gì báo lỗi.
  expect(style.fontFilePath).toBeTruthy()
  await expect(access(style.fontFilePath as string)).resolves.toBeUndefined()
})

test('chữ hiện trên preview trong khoảng đã đặt và biến mất ngoài đó', async () => {
  const overlay = page.locator('.text-overlay')

  // Tự đặt lại giờ thay vì dựa vào trạng thái các phép thử trước để lại: nhóm
  // phép thử kéo phía trên đã dời chữ đi chỗ khác.
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')

  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await expect(overlay).toContainText('Bạn đang bỏ lỡ thứ này')
  await expect.poll(overlayOpacity).toBeGreaterThan(0.5)

  // Tua ra ngoài khoảng: chữ phải biến mất, không dính lại trên màn hình.
  const ruler = page.locator('.timeline__ruler-row')
  const box = await ruler.boundingBox()
  await page.mouse.click(box!.x + 400, box!.y + 12)
  await expect(overlay).toHaveCount(0)
})

test('đổi hiệu ứng làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')

  // Đặt đầu phát vào GIỮA hiệu ứng vào rồi giữ nguyên; đổi vị trí giữa các lần
  // chụp thì hình khác nhau dù hiệu ứng có chạy hay không.
  //
  // "Tua tới đây" cố ý nhích QUA hiệu ứng vào để chữ nhìn thấy được, nên phải lùi
  // lại vài khung mới rơi vào trong hiệu ứng. Không lùi thì mọi kiểu hiệu ứng đều
  // đã chạy xong và cho ra khung hình y hệt nhau — phép thử xanh mà chẳng chứng
  // minh được gì.
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  for (let step = 0; step < 8; step += 1) {
    await page.getByRole('button', { name: 'Lùi một frame' }).click()
  }
  await page.waitForTimeout(700)

  await page.getByLabel('Hiệu ứng 1').selectOption('typewriter')
  await page.waitForTimeout(700)
  const typewriter = await stage.screenshot()

  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.waitForTimeout(700)
  const none = await stage.screenshot()

  // Gõ chữ hiện dần từng ký tự nên khung hình phải khác hẳn lúc hiện đủ ngay.
  expect(typewriter.equals(none)).toBe(false)
})

test('bật nền hộp làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const noBox = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('dark')
  await page.waitForTimeout(700)
  const darkBox = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('light')
  await page.waitForTimeout(700)
  const lightBox = await stage.screenshot()

  // Ba trạng thái phải cho ba khung hình KHÁC nhau. Hai cái giống nhau nghĩa là
  // ô chọn đổi dữ liệu mà lớp vẽ không đọc tới, và người dùng chỉnh vào hư không.
  expect(noBox.equals(darkBox)).toBe(false)
  expect(darkBox.equals(lightBox)).toBe(false)

  await page.getByLabel('Nền chữ 1').selectOption('none')
})

test('hiệu ứng ra làm chữ biến mất dần thay vì tắt phụt', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')

  // Cửa sổ hiệu ứng ra chỉ dài khoảng một phần ba giây, nên click vào thước để
  // rơi trúng nó là trò may rủi. Cách chắc chắn: tua tới ĐÚNG đầu khoảng chữ rồi
  // DỜI khoảng chữ lùi lại, để đầu phát nằm sẵn ở cuối khoảng mới.
  await page.getByLabel('Bắt đầu (giây) 1').fill('3')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  // "Tua tới đây" nhích vào một phần ba khối, tức đầu phát dừng ở 3,33s.
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  // Dời khoảng chữ để 3,33s rơi vào giữa hiệu ứng RA (khoảng 3,17s–3,5s).
  await page.getByLabel('Kết thúc (giây) 1').fill('3.5')
  await page.getByLabel('Bắt đầu (giây) 1').fill('2.4')
  await page.waitForTimeout(700)

  const overlay = page.locator('.text-overlay')
  await expect(overlay).toBeVisible()

  const shots = new Map<string, string>()
  for (const exit of ['none', 'fade', 'shrink', 'slide-down']) {
    await page.getByLabel('Hiệu ứng ra 1').selectOption(exit)
    await page.waitForTimeout(700)
    shots.set(exit, (await stage.screenshot()).toString('base64'))
  }

  // Bốn trạng thái, cùng một thời điểm, phải cho bốn khung hình khác nhau. Trùng
  // nhau nghĩa là ô chọn đổi dữ liệu mà lớp vẽ không đọc tới.
  expect(new Set(shots.values()).size).toBe(shots.size)

  await page.getByLabel('Hiệu ứng ra 1').selectOption('none')
})

test('viền phát sáng làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByLabel('Hiệu ứng ra 1').selectOption('none')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByLabel('Viền phát sáng 1').check()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(false)

  // Tắt đi phải trả về ĐÚNG khung cũ; còn khác nghĩa là có phần vẽ thừa nằm lại.
  await page.getByLabel('Viền phát sáng 1').uncheck()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(true)
})

test('đổi vị trí đưa chữ xuống dưới khung hình', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Hiệu ứng 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const middle = await stage.screenshot()

  await page.getByLabel('Vị trí 1').selectOption('2')
  await page.waitForTimeout(700)
  const bottom = await stage.screenshot()

  expect(bottom.equals(middle)).toBe(false)
})

test('chữ đi tới file xuất ra, không chỉ sống trong preview', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })

  // Dự án có chữ overlay nên app phải TỰ chọn Remotion và khoá lựa chọn lại:
  // xuất bằng ffmpeg sẽ ra file thiếu chữ mà không báo gì.
  const engine = dialog.getByLabel('Bộ dựng hình')
  await expect(engine).toHaveValue('remotion')
  await expect(engine).toBeDisabled()
  await expect(dialog.getByText(/phải dùng Remotion/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 600_000 })

  const stats = await stat(outputPath)
  expect(stats.size).toBeGreaterThan(10_000)

  // Nguồn là màn hình XÁM TRƠN — xám chứ không đen, để hộp tối và hộp sáng đều
  // nhìn ra được. Trích một khung trong khoảng có chữ: có chữ thì khung đó không
  // còn trơn, và ảnh nén ra sẽ lớn hơn hẳn khung ngoài khoảng.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const sizes: number[] = []
  for (const [name, at] of [
    ['co-chu', '2.5'],
    ['khong-chu', '6.5']
  ] as const) {
    const framePath = join(workDir, `${name}.png`)
    await execFileAsync(String(ffmpegStatic), [
      '-v',
      'error',
      '-y',
      '-ss',
      at,
      '-i',
      outputPath,
      '-frames:v',
      '1',
      framePath
    ])
    sizes.push((await stat(framePath)).size)
  }

  expect(sizes[0]).toBeGreaterThan(sizes[1] * 1.5)
})
