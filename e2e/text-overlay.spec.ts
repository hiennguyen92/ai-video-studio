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

/**
 * Đếm số ĐIỂM ẢNH khác nhau giữa hai ảnh chụp, thay vì so từng byte.
 *
 * So byte quá chặt cho việc cần chứng minh ở đây: khử răng cưa của GPU làm vài
 * điểm trên nét chữ lệch một hai mức giữa hai lần chụp cùng một khung hình. Đo
 * thật trên hai ảnh 1444×812 của cùng một khung: 2 điểm lệch, mức lệch tối đa 2.
 * Còn một vệt sáng sót lại quanh chữ thì thắp lên hàng trăm điểm.
 */
async function differingPixels(left: Buffer, right: Buffer): Promise<number> {
  const { writeFile } = await import('node:fs/promises')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const paths = [join(workDir, 'diff-a.png'), join(workDir, 'diff-b.png')]
  await writeFile(paths[0], left)
  await writeFile(paths[1], right)

  const width = left.readUInt32BE(16)
  const height = left.readUInt32BE(20)
  const decode = async (path: string): Promise<Buffer> => {
    const { stdout } = await execFileAsync(
      String(ffmpegStatic),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        path,
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        '-'
      ],
      { encoding: 'buffer', maxBuffer: 1 << 28 }
    )
    return stdout
  }

  const [a, b] = await Promise.all(paths.map(decode))
  let count = 0
  for (let index = 0; index < width * height * 3; index += 3) {
    if (
      Math.abs(a[index] - b[index]) > 2 ||
      Math.abs(a[index + 1] - b[index + 1]) > 2 ||
      Math.abs(a[index + 2] - b[index + 2]) > 2
    ) {
      count++
    }
  }
  return count
}

/**
 * So HÌNH DẠNG hai ô góc, sau khi trượt thử để căn gốc.
 *
 * Khối chữ căn giữa khung hình, nên đổi độ dài chữ là mép trái rơi vào một nửa
 * pixel khác — cả đường cong góc dịch đi chưa tới 1px và so thẳng từng pixel sẽ
 * báo hàng trăm điểm lệch dù góc không hề méo. Trượt thử mọi độ lệch rồi lấy cái
 * khớp nhất; phần dư mới là méo thật.
 *
 * Ô so phải HẸP HƠN bề dày viền. Rộng hơn là lấn sang vùng mép, mà mép thì lát
 * gạch co theo bề rộng chữ nên khác nhau là ĐÚNG — so cả vùng đó thì phép thử
 * luôn đỏ dù góc hoàn toàn lành.
 */
async function cornerShapeDiff(left: Buffer, right: Buffer, size = 22): Promise<number> {
  const [a, b] = await Promise.all([decodeRgb(left, size), decodeRgb(right, size)])
  let best = Number.MAX_SAFE_INTEGER
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      let count = 0
      for (let y = 3; y < size - 3; y++) {
        for (let x = 3; x < size - 3; x++) {
          const i = (y * size + x) * 3
          const j = ((y + dy) * size + (x + dx)) * 3
          if (
            Math.abs(a[i] - b[j]) > 6 ||
            Math.abs(a[i + 1] - b[j + 1]) > 6 ||
            Math.abs(a[i + 2] - b[j + 2]) > 6
          ) {
            count++
          }
        }
      }
      best = Math.min(best, count)
    }
  }
  return best
}

/** Giải một ảnh PNG đã cắt thành mảng RGB thô. */
async function decodeRgb(png: Buffer, size: number): Promise<Buffer> {
  const { writeFile } = await import('node:fs/promises')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const src = join(workDir, `raw-${Math.random().toString(36).slice(2)}.png`)
  await writeFile(src, png)
  const { stdout } = await execFileAsync(
    String(ffmpegStatic),
    [
      '-v',
      'error',
      '-i',
      src,
      '-vf',
      `scale=${size}:${size}`,
      '-pix_fmt',
      'rgb24',
      '-f',
      'rawvideo',
      '-'
    ],
    { encoding: 'buffer', maxBuffer: 1 << 26 }
  )
  return stdout
}

/** Cắt ô góc trên-trái của một ảnh PNG, để so hình dạng góc giữa hai bề rộng. */
async function cropTopLeft(png: Buffer, size = 22): Promise<Buffer> {
  const { writeFile } = await import('node:fs/promises')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const src = join(workDir, 'goc-src.png')
  const out = join(workDir, `goc-${Math.random().toString(36).slice(2)}.png`)
  await writeFile(src, png)
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-i',
    src,
    '-vf',
    `crop=${size}:${size}:0:0`,
    out
  ])
  const { readFile } = await import('node:fs/promises')
  return readFile(out)
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
  await expect(timeline.getByText('Text', { exact: true })).toBeVisible()

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
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))

  await page.locator('.timeline-text-block--overlay').first().click()
  await expect(page.locator('.text-overlay')).toContainText('Bạn đang bỏ lỡ thứ này')
  await expect(page.locator('.timeline-text-block--active')).toHaveCount(1)

  // Và phải NHÌN THẤY được. Tua tới đúng mốc bắt đầu là rơi trúng khung mà hiệu
  // ứng vào còn ở opacity 0 — bấm vào một câu để xem nó rồi thấy màn hình trống.
  await expect.poll(overlayOpacity).toBeGreaterThan(0.5)
})

test('bấm vào khối chữ thì panel thuộc tính hiện đúng khối đó', async () => {
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })

  // Chọn clip trước, để lần bấm sau chứng minh được panel thật sự ĐỔI sang chữ
  // chứ không phải vốn đã hiện sẵn.
  await page.locator('.timeline-clip').first().click()
  await expect(inspector.getByText('Điểm vào nguồn')).toBeVisible()

  await page
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  const block = page.locator('.timeline-text-block--overlay').first()
  await block.click()

  // Panel nói về chữ, và những hàng của clip biến mất — hai thứ không được cùng
  // hiện, nếu không người dùng không biết mình đang sửa cái nào.
  await expect(inspector.getByText('Text', { exact: true }).first()).toBeVisible()
  await expect(inspector.getByText('Điểm vào nguồn')).toHaveCount(0)
  await expect(inspector.getByLabel('Nội dung', { exact: true })).toHaveValue(
    'Bạn đang bỏ lỡ thứ này'
  )

  // Khối cũng phải TRÔNG như đang được chọn.
  await expect(block).toHaveClass(/timeline-text-block--selected/)

  // Bấm lại vào clip thì panel quay về clip, và khối chữ hết được chọn.
  await page.locator('.timeline-clip').first().click()
  await expect(inspector.getByText('Điểm vào nguồn')).toBeVisible()
  await expect(block).not.toHaveClass(/timeline-text-block--selected/)
})

test('sửa chữ ngay trong panel thuộc tính thì preview đổi theo', async () => {
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await page.locator('.timeline-text-block--overlay').first().click()

  await inspector.getByLabel('Nội dung', { exact: true }).fill('Đổi từ panel')
  await expect(page.locator('.text-overlay')).toContainText('Đổi từ panel')

  // Ô trong tab Phụ đề phải thấy cùng một giá trị: hai chỗ sửa cùng MỘT dữ liệu,
  // không phải hai bản sao trôi khỏi nhau.
  await expect(studio().getByLabel('Nội dung 1')).toHaveValue('Đổi từ panel')

  await inspector.getByLabel('Nội dung', { exact: true }).fill('Bạn đang bỏ lỡ thứ này')
})

test('xoay chữ từ panel thuộc tính làm nghiêng chữ trên preview', async () => {
  const inspector = page.getByRole('region', { name: 'Thuộc tính' })
  await page.locator('.timeline-text-block--overlay').first().click()

  const rotationOf = async (): Promise<string> =>
    page
      .locator('.text-overlay > div')
      .first()
      .evaluate((node) => getComputedStyle(node).transform)

  const before = await rotationOf()
  await inspector.getByLabel('Góc xoay').fill('20')

  // Ma trận biến đổi phải ĐỔI. Chỉ đọc thuộc tính style trên DOM thì một góc bị
  // ghi vào chỗ không có tác dụng vẫn cho ra chuỗi "đúng".
  await expect.poll(rotationOf).not.toBe(before)
  expect(await rotationOf()).not.toBe('none')

  await inspector.getByLabel('Góc xoay').fill('0')
})

test('chọn khối chữ rồi bấm Delete thì xoá đúng chữ đó', async () => {
  // Thêm một chữ nữa để xoá, giữ nguyên chữ gốc cho các phép thử sau.
  await page.getByRole('button', { name: 'Thêm chữ' }).click()
  await studio().getByLabel('Nội dung 2').fill('Chữ sắp bị xoá')
  const blocks = page.locator('.timeline-text-block--overlay')
  await expect(blocks).toHaveCount(2)

  await page
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await blocks.filter({ hasText: 'Chữ sắp bị xoá' }).click()
  await page.keyboard.press('Delete')

  // Đúng MỘT khối bị xoá, và là khối vừa chọn — không phải clip video, cũng
  // không phải chữ còn lại.
  await expect(blocks).toHaveCount(1)
  await expect(blocks.first()).toContainText('Bạn đang bỏ lỡ thứ này')
  await expect(page.locator('.timeline-clip')).toHaveCount(1)

  // Hoàn tác được, và nhãn nói đúng việc vừa làm.
  await expect(page.getByRole('button', { name: /Hoàn tác: Xoá chữ/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(blocks).toHaveCount(2)

  // Làm lại để trả về đúng một chữ cho các phép thử sau. Dọn bằng nút "Xoá chữ"
  // thì không được: nút hoàn tác trên thanh trên cùng mang tên "Hoàn tác: Xoá
  // chữ", nên nó lọt vào cùng danh sách và nth(1) trỏ nhầm sang chữ gốc.
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(blocks).toHaveCount(1)
  await expect(blocks.first()).toContainText('Bạn đang bỏ lỡ thứ này')
})

test('kéo chữ trên khung xem trước thì dời chữ và ghim vị trí', async () => {
  await page
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await page.locator('.timeline-text-block--overlay').first().click()

  // Khung điều khiển chỉ hiện khi có khối chữ đang chọn VÀ chữ đang trên hình.
  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const before = await page.locator('.text-overlay .text-block').boundingBox()
  await gizmo.hover()
  const box = await gizmo.boundingBox()

  // Kéo lên trên và sang trái một quãng rõ ràng.
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 - 60, box!.y + box!.height / 2 - 50, { steps: 8 })
  await page.mouse.up()

  // Chữ THẬT phải dời theo, không chỉ cái khung.
  await expect
    .poll(async () => (await page.locator('.text-overlay .text-block').boundingBox())!.y)
    .toBeLessThan(before!.y - 30)

  // Và phải được ghim lại trong dự án, để bản xuất cũng đặt đúng chỗ đó.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const position = await savedOverlayStyle()
  expect(position.position).toBeDefined()
  expect(position.position!.xPct).toBeGreaterThan(0)
  expect(position.position!.xPct).toBeLessThan(1)

  // Một lần kéo là MỘT bước hoàn tác, và hoàn tác trả chữ về chỗ cũ.
  await expect(page.getByRole('button', { name: /Hoàn tác: Dời chữ/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await page.locator('.text-overlay .text-block').boundingBox())!.y)
    .toBeGreaterThan(before!.y - 10)
})

test('kéo tay nắm tròn thì xoay chữ', async () => {
  await page.locator('.timeline-text-block--overlay').first().click()
  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const rotationOf = async (): Promise<string> =>
    page.locator('.text-overlay .text-block').evaluate((node) => getComputedStyle(node).transform)
  const before = await rotationOf()

  // `hover()` chờ phần tử đứng yên hai khung hình liên tiếp rồi mới đưa chuột
  // tới. Đo toạ độ rồi bấm thẳng thì không có bước chờ đó: khung gizmo đo lại
  // theo từng khung hình, nên tay nắm có thể đã dịch đi và cú bấm rơi vào thân
  // khung — thành ra kéo DỜI chứ không kéo xoay, và phép thử đỏ lúc được lúc không.
  const handle = page.locator('.preview-gizmo__rotate')
  await handle.hover()
  const box = await gizmo.boundingBox()
  await page.mouse.down()
  // Kéo tay nắm sang phải, tức xoay xuôi chiều kim đồng hồ.
  await page.mouse.move(box!.x + box!.width / 2 + 90, box!.y - 30, { steps: 8 })
  await page.mouse.up()

  await expect.poll(rotationOf).not.toBe(before)

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const style = await savedOverlayStyle()
  expect(style.rotationDeg).toBeGreaterThan(0)
  // Xoay bằng tay nắm cũng ghim vị trí: có ghim thì tâm xoay mới là tâm khối,
  // đúng thứ tay nắm gợi ý.
  expect(style.position).toBeDefined()

  // Dọn lại cho các phép thử sau: bỏ ghim và trả góc về 0.
  await page.getByRole('button', { name: 'Bỏ ghim' }).first().click()
  await studio()
    .getByLabel(/Góc xoay/)
    .fill('0')
})

/** Đọc kiểu chữ của chữ đầu tiên từ chính file dự án đã lưu. */
async function savedOverlayStyle(): Promise<{
  rotationDeg?: number
  outlineWidthPx?: number
  position?: { xPct: number; yPct: number }
}> {
  const { readFile, readdir } = await import('node:fs/promises')
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    textOverlays: Array<{
      style: {
        rotationDeg?: number
        outlineWidthPx?: number
        position?: { xPct: number; yPct: number }
      }
    }>
  }
  return document.textOverlays[0].style
}

test('nút Thêm track text tạo một lane chữ thật, và chữ mới rơi vào đó', async () => {
  const timeline = page.getByRole('region', { name: 'Timeline' })
  await expect(page.locator('.timeline-lane--text')).toHaveCount(0)

  await timeline.getByRole('button', { name: 'Thêm track Text' }).click()
  await expect(page.locator('.timeline-lane--text')).toHaveCount(1)
  await expect(timeline.getByTitle('Text 1')).toBeVisible()

  // Chữ thêm sau đó phải rơi vào lane vừa tạo, nếu không cái nút chẳng để làm gì.
  await page.getByRole('button', { name: 'Thêm chữ' }).click()
  await studio().getByLabel('Nội dung 2').fill('Trên lane mới')

  const laneBlocks = page.locator('.timeline-lane--text .timeline-text-block--overlay')
  await expect(laneBlocks).toHaveCount(1)
  await expect(laneBlocks.first()).toContainText('Trên lane mới')

  // Chữ cũ chưa thuộc lane nào vẫn nằm ở lane ảo, không bị kéo sang.
  await expect(page.locator('.timeline-lane--overlay .timeline-text-block')).toHaveCount(1)
})

test('kéo khối chữ sang lane khác thì nó đổi lane', async () => {
  // Lane thứ hai để có chỗ mà kéo sang.
  await page
    .getByRole('region', { name: 'Timeline' })
    .getByRole('button', { name: 'Thêm track Text' })
    .click()
  await expect(page.locator('.timeline-lane--text')).toHaveCount(2)

  const lanes = page.locator('.timeline-lane--text')
  const block = lanes.nth(0).locator('.timeline-text-block--overlay')
  await expect(block).toHaveCount(1)

  const from = await block.boundingBox()
  const to = await lanes.nth(1).boundingBox()

  // Kéo THẲNG XUỐNG: đổi lane mà không đổi giờ là thao tác thường gặp nhất, và
  // là ca dễ bị bỏ sót nhất vì con trỏ không dịch ngang chút nào.
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2, to!.y + to!.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect(lanes.nth(0).locator('.timeline-text-block--overlay')).toHaveCount(0)
  await expect(lanes.nth(1).locator('.timeline-text-block--overlay')).toHaveCount(1)
  await expect(lanes.nth(1).locator('.timeline-text-block--overlay')).toContainText('Trên lane mới')

  // Một lần kéo là MỘT bước hoàn tác, và hoàn tác trả khối về lane cũ.
  await expect(
    page.getByRole('button', { name: /Hoàn tác: Dời Text sang track khác/ })
  ).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(lanes.nth(0).locator('.timeline-text-block--overlay')).toHaveCount(1)

  // Dọn lane vừa thêm.
  await page
    .locator('.track-head')
    .filter({ hasText: 'Text 2' })
    .getByRole('button', { name: 'Xoá track' })
    .click()
  await expect(page.locator('.timeline-lane--text')).toHaveCount(1)
})

test('không thả được khối chữ vào lane hình', async () => {
  const lane = page.locator('.timeline-lane--text').first()
  const block = lane.locator('.timeline-text-block--overlay')
  const from = await block.boundingBox()
  const videoLane = await page.locator('.timeline-lane--video').first().boundingBox()

  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
  await page.mouse.down()
  await page.mouse.move(from!.x + from!.width / 2, videoLane!.y + videoLane!.height / 2, {
    steps: 10
  })
  await page.mouse.up()

  // Khối phải ở nguyên lane chữ. Lọt sang lane hình thì nó biến mất khỏi mọi
  // lane, vì lane hình chỉ vẽ clip.
  await expect(lane.locator('.timeline-text-block--overlay')).toHaveCount(1)
  await expect(page.locator('.timeline-lane--video .timeline-text-block')).toHaveCount(0)
})

test('ẩn lane chữ chỉ giấu chữ TRÊN LANE ĐÓ, không giấu chữ khác', async () => {
  const onLane = page.locator('.text-overlay').filter({ hasText: 'Trên lane mới' })
  const loose = page.locator('.text-overlay').filter({ hasText: 'Bạn đang bỏ lỡ thứ này' })

  await page.locator('.timeline-text-block--overlay').filter({ hasText: 'Trên lane mới' }).click()
  await expect(onLane).toHaveCount(1)
  await expect(loose).toHaveCount(1)

  const head = page.locator('.track-head').filter({ hasText: 'Text 1' })
  await head.getByRole('button', { name: 'Ẩn' }).click()

  // Chỉ chữ của lane bị ẩn mất đi. Giấu cả hai nghĩa là nút ẩn đang tắt toàn bộ
  // lớp chữ chứ không tắt đúng lane.
  await expect(onLane).toHaveCount(0)
  await expect(loose).toHaveCount(1)

  await head.getByRole('button', { name: 'Hiện' }).click()
  await expect(onLane).toHaveCount(1)
})

test('xoá lane chữ thì xoá luôn chữ trên nó, và hoàn tác trả lại cả hai', async () => {
  const head = page.locator('.track-head').filter({ hasText: 'Text 1' })
  await head.getByRole('button', { name: 'Xoá track' }).click()

  await expect(page.locator('.track-head').filter({ hasText: 'Text 1' })).toHaveCount(0)
  // Chữ phải đi theo lane: còn sót thì nó vẫn vẽ lên hình mà không còn chỗ nào
  // trên timeline để bấm vào sửa.
  await expect(
    page.locator('.timeline-text-block--overlay').filter({ hasText: 'Trên lane mới' })
  ).toHaveCount(0)
  await expect(page.locator('.timeline-text-block--overlay')).toHaveCount(1)

  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.track-head').filter({ hasText: 'Text 1' })).toHaveCount(1)
  await expect(page.locator('.timeline-text-block--overlay')).toHaveCount(2)

  // Dọn lại: xoá hẳn lane để các phép thử sau vẫn làm việc với đúng một chữ.
  await page
    .locator('.track-head')
    .filter({ hasText: 'Text 1' })
    .getByRole('button', { name: 'Xoá track' })
    .click()
  await expect(page.locator('.timeline-text-block--overlay')).toHaveCount(1)
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
  await page.getByLabel('Animation vào 1').selectOption('none')
  await page.getByLabel('Animation ra 1').selectOption('none')
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

  await page.getByLabel('Animation vào 1').selectOption('typewriter')
  await page.waitForTimeout(700)
  const typewriter = await stage.screenshot()

  await page.getByLabel('Animation vào 1').selectOption('none')
  await page.waitForTimeout(700)
  const none = await stage.screenshot()

  // Gõ chữ hiện dần từng ký tự nên khung hình phải khác hẳn lúc hiện đủ ngay.
  expect(typewriter.equals(none)).toBe(false)
})

test('bật nền hộp làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Animation vào 1').selectOption('none')
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
  await page.getByLabel('Animation vào 1').selectOption('none')

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
    await page.getByLabel('Animation ra 1').selectOption(exit)
    await page.waitForTimeout(700)
    shots.set(exit, (await stage.screenshot()).toString('base64'))
  }

  // Bốn trạng thái, cùng một thời điểm, phải cho bốn khung hình khác nhau. Trùng
  // nhau nghĩa là ô chọn đổi dữ liệu mà lớp vẽ không đọc tới.
  expect(new Set(shots.values()).size).toBe(shots.size)

  await page.getByLabel('Animation ra 1').selectOption('none')
})

test('viền phát sáng làm đổi hình, ở cùng một thời điểm', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Animation vào 1').selectOption('none')
  await page.getByLabel('Animation ra 1').selectOption('none')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByLabel('Viền phát sáng 1').check()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(false)

  // Tắt đi phải trả về đúng khung cũ; còn vệt sáng nào nằm lại là thấy ngay.
  await page.getByLabel('Viền phát sáng 1').uncheck()
  await page.waitForTimeout(700)
  expect(await differingPixels(await stage.screenshot(), plain)).toBeLessThan(20)
})

test('đổi vị trí đưa chữ xuống dưới khung hình', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Animation vào 1').selectOption('none')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const middle = await stage.screenshot()

  await page.getByLabel('Vị trí 1').selectOption('2')
  await page.waitForTimeout(700)
  const bottom = await stage.screenshot()

  expect(bottom.equals(middle)).toBe(false)
})

/**
 * Khung nền dễ thương.
 *
 * Điều đắt nhất phải chứng minh là vế TẮT: chọn khung rồi bỏ khung phải trả về
 * đúng khung hình cũ. Đường ghi của khung có ba trạng thái, và nếu `null` bị nuốt
 * ở bất cứ tầng nào — schema, planner, reducer — thì khung nằm lại trên hình mà
 * mọi phép thử "bật lên có đổi hình" vẫn xanh.
 */
test('năm khung cho năm hình khác nhau', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Animation vào 1').selectOption('none')
  await page.getByLabel('Animation ra 1').selectOption('none')
  await page.getByLabel('Bắt đầu (giây) 1').fill('1')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)

  const shots = new Map<string, Buffer>()
  for (const id of ['bong-bong-thoai', 'may', 'giay-xe', 'vien-lap-lanh', 'net-ve-tay']) {
    await page.getByLabel('Nền chữ 1').selectOption(id)
    await page.waitForTimeout(700)
    shots.set(id, await stage.screenshot())
  }

  // Năm ô chọn khác nhau phải ra năm hình khác nhau: trùng nhau nghĩa là ô ghi
  // được dữ liệu mà lớp vẽ không đọc tới.
  expect(new Set(shots.values()).size).toBe(shots.size)

  await page.getByLabel('Nền chữ 1').selectOption('none')
})

test('bỏ khung trả về đúng khung hình cũ', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('may')
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(false)

  // Vế đắt: còn sót lại mảng khung nào là thấy ngay ở đây.
  await page.getByLabel('Nền chữ 1').selectOption('none')
  await page.waitForTimeout(700)
  expect(await differingPixels(await stage.screenshot(), plain)).toBeLessThan(20)
})

test('đổi bộ màu và trang trí góc đều làm đổi hình', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByLabel('Nền chữ 1').selectOption('may')
  await page.waitForTimeout(700)
  const hong = await stage.screenshot()

  await page.getByLabel('Màu khung 1').selectOption('xanh-mint')
  await page.waitForTimeout(700)
  const mint = await stage.screenshot()
  expect(mint.equals(hong)).toBe(false)

  await page.getByLabel('Trang trí góc 1').selectOption('ngoi-sao')
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(mint)).toBe(false)

  await page.getByLabel('Trang trí góc 1').selectOption('')
  await page.getByLabel('Nền chữ 1').selectOption('none')
})

/**
 * Khung ảnh PNG: màu nằm sẵn trong ảnh, nên hai ô bộ màu và trang trí không có mặt,
 * và chữ phải đổi sang màu hợp với ruột khung.
 */
test('khung ảnh đổi hình, đổi màu chữ, và không có ô bộ màu', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByLabel('Nền chữ 1').selectOption('chalkboard')
  await page.waitForTimeout(700)
  const board = await stage.screenshot()
  expect(board.equals(plain)).toBe(false)
  await expect(page.getByLabel('Màu khung 1')).toHaveCount(0)
  await expect(page.getByLabel('Trang trí góc 1')).toHaveCount(0)
  // Bảng đen tối màu: chữ phải sáng lên, không giữ màu tối của khung trước.
  await expect(page.locator('.text-overlay span').first()).toHaveCSS('color', 'rgb(244, 240, 230)')

  await page.getByLabel('Nền chữ 1').selectOption('sticky-note')
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(board)).toBe(false)

  // Bỏ khung vẫn phải trả về đúng khung hình cũ, kể cả lớp ruột vẽ riêng.
  await page.getByLabel('Nền chữ 1').selectOption('none')
  await page.waitForTimeout(700)
  expect(await differingPixels(await stage.screenshot(), plain)).toBeLessThan(20)
})

/**
 * Lưới ảnh thu nhỏ: bấm một ô phải đi đúng đường của ô chọn — đổi khung, đổi
 * màu chữ — và ô đang dùng phải được đánh dấu, kể cả khi khung chọn từ ô chọn.
 */
test('lưới ảnh thu nhỏ chọn được khung và đánh dấu khung đang dùng', async () => {
  const stage = page.locator('.preview__stage')
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page.waitForTimeout(700)
  const plain = await stage.screenshot()

  await page.getByRole('button', { name: 'Chọn khung bằng hình 1' }).click()
  const anh = page.getByRole('group', { name: 'Khung ảnh 1' })
  await expect(anh.getByRole('button')).toHaveCount(42)

  await anh.getByRole('button', { name: 'Bảng đen' }).click()
  await page.waitForTimeout(700)
  expect((await stage.screenshot()).equals(plain)).toBe(false)
  // Ô chọn và lưới là hai lối vào CÙNG một giá trị: lệch nhau là một trong hai nói dối.
  await expect(page.getByLabel('Nền chữ 1')).toHaveValue('chalkboard')
  await expect(anh.getByRole('button', { name: 'Bảng đen' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(page.locator('.text-overlay span').first()).toHaveCSS('color', 'rgb(244, 240, 230)')

  // Chọn từ ô chọn thì lưới phải đổi dấu theo.
  await page.getByLabel('Nền chữ 1').selectOption('may')
  await expect(
    page.getByRole('group', { name: 'Khung dễ thương 1' }).getByRole('button', { name: 'Mây' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(anh.getByRole('button', { name: 'Bảng đen' })).toHaveAttribute(
    'aria-pressed',
    'false'
  )

  await page.getByLabel('Nền chữ 1').selectOption('none')
  await page.getByRole('button', { name: 'Ẩn bảng khung 1' }).click()
  await expect(anh).toHaveCount(0)
})

/**
 * Đệm khung: ĐO kích thước khối khung trên xem trước, không chỉ kiểm hình đổi —
 * hình đổi cũng xảy ra khi thanh trượt lỡ tay co giãn cả viền.
 */
test('thanh trượt đệm khung làm khung ôm sát hoặc rộng ra', async () => {
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await expect(page.getByLabel('Đệm ngang khung 1')).toHaveCount(0)

  await page.getByLabel('Nền chữ 1').selectOption('sticky-note')
  const khung = page.locator('.text-overlay > div').first()
  const doKhung = async (): Promise<{ width: number; height: number }> => {
    await page.waitForTimeout(500)
    const box = await khung.boundingBox()
    return { width: box!.width, height: box!.height }
  }
  const macDinh = await doKhung()

  await page.getByLabel('Đệm ngang khung 1').fill('0')
  const satNgang = await doKhung()
  expect(satNgang.width).toBeLessThan(macDinh.width)
  // Chỉnh chiều ngang không được kéo theo chiều dọc.
  expect(Math.abs(satNgang.height - macDinh.height)).toBeLessThan(1)

  await page.getByLabel('Đệm dọc khung 1').fill('300')
  const rongDoc = await doKhung()
  expect(rongDoc.height).toBeGreaterThan(macDinh.height)

  // Đổi sang khung khác vẫn giữ độ rộng đã chỉnh.
  await page.getByLabel('Nền chữ 1').selectOption('chalkboard')
  await expect(page.getByLabel('Đệm ngang khung 1')).toHaveValue('0')
  await expect(page.getByLabel('Đệm dọc khung 1')).toHaveValue('300')

  await page.getByLabel('Nền chữ 1').selectOption('none')
  await expect(page.getByLabel('Đệm ngang khung 1')).toHaveCount(0)
})

/**
 * Kéo mép khung ngay trên xem trước. ĐO khối chữ thật và đọc lại thanh trượt:
 * khung điều khiển chạy theo chuột là chuyện của giao diện, còn cái cần chứng
 * minh là tài liệu đổi và bản vẽ đổi theo.
 */
test('kéo mép khung trên xem trước làm khung rộng ra hoặc ôm sát chữ', async () => {
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  await page
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await page.locator('.timeline-text-block--overlay').first().click()
  await expect(page.locator('.preview-gizmo')).toBeVisible()
  // Chưa có khung thì không có tay nắm mép: tay nắm không làm gì là tệ hơn không có.
  await expect(page.locator('.preview-gizmo__edge')).toHaveCount(0)

  await page.getByLabel('Nền chữ 1').selectOption('sticky-note')
  await expect(page.locator('.preview-gizmo__edge')).toHaveCount(4)
  const block = page.locator('.text-overlay .text-block')
  const before = (await block.boundingBox())!

  const dragEdge = async (edge: string, dx: number, dy: number): Promise<void> => {
    const handle = page.locator(`.preview-gizmo__edge--${edge}`)
    // `hover()` chờ tay nắm đứng yên: khung điều khiển đo lại theo từng khung hình.
    await handle.hover()
    const box = (await handle.boundingBox())!
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 })
    await page.mouse.up()
  }

  await dragEdge('right', 40, 0)
  await expect
    .poll(async () => (await block.boundingBox())!.width)
    .toBeGreaterThan(before.width + 20)
  expect(Number(await page.getByLabel('Đệm ngang khung 1').inputValue())).toBeGreaterThan(100)
  // Chỉ trục ngang đổi.
  await expect(page.getByLabel('Đệm dọc khung 1')).toHaveValue('100')
  // Một lần kéo là MỘT bước hoàn tác.
  await expect(page.getByRole('button', { name: /Hoàn tác: Kéo đệm ngang khung/ })).toBeVisible()

  await dragEdge('top', 0, 60)
  await expect(page.getByLabel('Đệm dọc khung 1')).toHaveValue('0')
  await expect.poll(async () => (await block.boundingBox())!.height).toBeLessThan(before.height)

  await page.getByLabel('Nền chữ 1').selectOption('none')
  await expect(page.locator('.preview-gizmo__edge')).toHaveCount(0)
})

test('chỉnh độ dày viền chữ, và nó tới được chữ trên hình', async () => {
  const slider = studio().getByLabel('Độ dày viền 1')
  await expect(slider).toHaveAttribute('max', '20')
  const strokeOf = async (): Promise<string> =>
    page
      .locator('.text-overlay .text-block span')
      .first()
      .evaluate((node) => getComputedStyle(node).webkitTextStrokeWidth)

  await slider.fill('12')
  await expect.poll(strokeOf).toBe('12px')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  expect((await savedOverlayStyle()).outlineWidthPx).toBe(12)

  // 0 là bỏ viền hẳn.
  await slider.fill('0')
  await expect.poll(strokeOf).toBe('0px')

  await slider.fill('3')
})

test('góc xoay không còn kẹp ở 45°: xoay dựng đứng và lộn ngược được', async () => {
  const slider = studio().getByLabel('Góc xoay 1')
  await expect(slider).toHaveAttribute('min', '-180')
  await expect(slider).toHaveAttribute('max', '180')

  await slider.fill('135')
  await expect(slider).toHaveValue('135')
  // Góc phải tới được chữ trên hình, không chỉ nằm ở thanh trượt.
  await expect
    .poll(async () =>
      page.locator('.text-overlay .text-block').evaluate((node) => getComputedStyle(node).transform)
    )
    .not.toBe('none')
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  expect((await savedOverlayStyle()).rotationDeg).toBe(135)

  await slider.fill('0')
})

test('kéo chữ sát mép khung hình không làm chữ tự xuống hàng', async () => {
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  const content = page.getByLabel('Nội dung 1')
  const original = await content.inputValue()
  await content.fill('Chốt đơn hôm nay')

  await page
    .locator('.timeline__body')
    .evaluate((element) => element.scrollTo({ top: element.scrollHeight }))
  await page.locator('.timeline-text-block--overlay').first().click()
  const gizmo = page.locator('.preview-gizmo')
  await expect(gizmo).toBeVisible()

  const block = page.locator('.text-overlay .text-block')
  const lines = page.locator('.text-overlay .text-block span')
  await expect(lines).toHaveCount(1)
  const before = (await block.boundingBox())!
  const stage = (await page.locator('.preview__stage').boundingBox())!

  // Kéo tâm chữ ra sát mép phải: trước đây khối chỉ được rộng tới mép, và chữ bị
  // ép thành một cột mỗi từ một dòng.
  await gizmo.hover()
  const box = (await gizmo.boundingBox())!
  await page.mouse.down()
  await page.mouse.move(stage.x + stage.width - 8, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()

  await expect.poll(async () => (await block.boundingBox())!.x).toBeGreaterThan(before.x + 50)
  await expect(lines).toHaveCount(1)
  const after = (await block.boundingBox())!
  expect(Math.abs(after.width - before.width)).toBeLessThan(2)
  expect(Math.abs(after.height - before.height)).toBeLessThan(2)

  // Dọn lại cho các phép thử sau.
  await page.getByRole('button', { name: 'Bỏ ghim' }).first().click()
  await content.fill(original)
})

test('xuống dòng trong nội dung thì preview cũng xuống dòng', async () => {
  await page.getByRole('button', { name: 'Tua tới đây' }).click()
  const content = page.getByLabel('Nội dung 1')
  const original = await content.inputValue()
  const lines = page.locator('.text-overlay .text-block span')

  await content.fill('Chốt đơn')
  await expect(lines).toHaveCount(1)
  const oneLineHeight = (await page.locator('.text-overlay .text-block').boundingBox())!.height

  // Enter hai lần giữa hai đoạn: dòng trống cũng phải còn chiều cao trên hình.
  await content.fill('Chốt đơn\nhôm nay\n\nGiá 99k')
  await expect(lines).toHaveCount(4)
  await expect(lines.nth(0)).toHaveText('Chốt đơn')
  await expect(lines.nth(1)).toHaveText('hôm nay')
  await expect(lines.nth(3)).toHaveText('Giá 99k')
  await expect
    .poll(async () => (await page.locator('.text-overlay .text-block').boundingBox())!.height)
    .toBeGreaterThan(oneLineHeight * 3)

  // Xuống dòng phải được LƯU, không chỉ hiện trên hình.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await expect(content).toHaveValue('Chốt đơn\nhôm nay\n\nGiá 99k')

  await content.fill(original)
})

test('hai ô của khung không tồn tại khi chưa chọn khung', async () => {
  // KHÔNG TỒN TẠI, không phải bị làm mờ: một ô "Màu khung" khi không có khung là
  // một ô không có tác dụng.
  await expect(page.getByLabel('Màu khung 1')).toHaveCount(0)

  await page.getByLabel('Nền chữ 1').selectOption('may')
  await expect(page.getByLabel('Màu khung 1')).toHaveCount(1)

  await page.getByLabel('Nền chữ 1').selectOption('none')
  await expect(page.getByLabel('Màu khung 1')).toHaveCount(0)
})

test('góc khung không méo khi chữ dài ra', async () => {
  const block = page.locator('.text-block')
  await page.getByLabel('Nền chữ 1').selectOption('may')
  await page.getByLabel('Nội dung 1').fill('Sale')
  await page.waitForTimeout(700)
  const ngan = await block.screenshot()

  await page.getByLabel('Nội dung 1').fill('Ba dong chu dai hon nua de xuong dong o day nhe')
  await page.waitForTimeout(700)
  const dai = await block.screenshot()

  expect(dai.equals(ngan)).toBe(false)
  // Góc vẽ đúng bằng bề dày viền nên KHÔNG được co giãn theo chữ. Ô góc trên-trái
  // phải giống hệt nhau; khác đi nghĩa là hình bị kéo méo — đúng thứ mà cách vẽ
  // chín ô sinh ra để tránh.
  const lech = await cornerShapeDiff(await cropTopLeft(ngan), await cropTopLeft(dai))
  expect(lech, `góc lệch ${lech} điểm`).toBeLessThan(30)

  await page.getByLabel('Nội dung 1').fill('Chốt đơn ngay')
  await page.getByLabel('Nền chữ 1').selectOption('none')
})

test('khung đi tới file xuất ra, không chỉ sống trong preview', async () => {
  await page.getByLabel('Nền chữ 1').selectOption('may')
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: 'Xuất video' }).click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 600_000 })

  // Nguồn là màn hình xám trơn. Khung phủ nhiều pixel hơn hẳn chữ trần, nên khung
  // hình trong khoảng có chữ nén ra lớn hơn nhiều so với khung hình ngoài khoảng.
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  const sizes: number[] = []
  for (const [name, at] of [
    ['co-khung', '2.5'],
    ['khong-chu', '6.5']
  ] as const) {
    const framePath = join(workDir, `khung-${name}.png`)
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

  // Đóng hộp thoại lại: file này chạy tuần tự trên MỘT cửa sổ, và một hộp thoại
  // để mở sẽ chặn mọi cú bấm của phép thử sau.
  await dialog.getByRole('button', { name: 'Đóng' }).click()
  await page.getByLabel('Nền chữ 1').selectOption('none')
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
