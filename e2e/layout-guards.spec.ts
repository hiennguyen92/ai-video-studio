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
 * Hàng rào BỐ CỤC: những lỗi chỉ thấy bằng mắt, đo bằng toạ độ.
 *
 * Mọi phép thử khác kiểm HÀNH VI — bấm được, ghi đúng — nên chúng vẫn xanh khi
 * nút "Xuất video" bị đẩy ra ngoài cửa sổ hẹp, hay chữ trong hộp thoại dính sát
 * mép. Cả hai lỗi đó đã thực sự lọt qua. Ở đây chạy ở cỡ cửa sổ NHỎ NHẤT cho phép
 * (1120×680), bằng cả hai ngôn ngữ (tiếng Anh thường dài hơn), và báo đích danh
 * phần tử nào tràn.
 */

const execFileAsync = promisify(execFile)
const MIN_WIDTH = 1120
const MIN_HEIGHT = 680

let app: ElectronApplication
let page: Page
let userDataDir: string

test.describe.configure({ mode: 'serial' })

/**
 * Phần tử con nhìn thấy được mà vượt ra ngoài `container` (trừ lề `inset`).
 * Trả mô tả đọc được để lỗi chỉ thẳng vào chỗ hỏng.
 */
async function escapees(
  containerSelector: string,
  childSelector: string,
  inset: { left: number; right: number },
  /**
   * `content`: đo chỗ CHỮ bắt đầu (trừ padding) — cho đoạn chữ tự thụt vào bằng
   * padding. `border`: đo cả khung — cho nút, ô nhập, thứ có viền nhìn thấy.
   */
  measure: 'content' | 'border' = 'border'
): Promise<string[]> {
  return page.evaluate(
    ({ containerSelector, childSelector, inset, measure }) => {
      const container = document.querySelector(containerSelector)
      if (!container) return [`không thấy ${containerSelector}`]
      const box = container.getBoundingClientRect()
      const bounds = {
        left: box.left + inset.left,
        right: Math.min(box.right, window.innerWidth) - inset.right
      }
      const problems: string[] = []
      for (const element of container.querySelectorAll<HTMLElement>(childSelector)) {
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        const style = getComputedStyle(element)
        const rect =
          measure === 'content'
            ? {
                left: box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth),
                right:
                  box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth)
              }
            : { left: box.left, right: box.right }
        if (rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5) {
          const name =
            element.getAttribute('aria-label') ??
            element.textContent?.trim().slice(0, 40) ??
            element.className
          problems.push(
            `${element.tagName.toLowerCase()} "${name}" [${Math.round(rect.left)}–${Math.round(rect.right)}] ngoài [${Math.round(bounds.left)}–${Math.round(bounds.right)}]`
          )
        }
      }
      return problems
    },
    { containerSelector, childSelector, inset, measure }
  )
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-layout-'))
  const video = join(userDataDir, 'canh-quay-san-pham-review-rat-dai.mp4')
  const ffmpegPath = String((await import('ffmpeg-static')).default)
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=4',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=4',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
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
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size.width, size.height)
    },
    { width: MIN_WIDTH, height: MIN_HEIGHT }
  )

  // Tên dự án dài — thứ đã đẩy nút Xuất video ra ngoài.
  await page
    .getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm')
    .fill('Review tai nghe chống ồn — bản dựng dọc cho TikTok, Reels và Shorts')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await page.locator('.timeline-lane--video .timeline-clip').first().waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
})

for (const language of ['vi', 'en'] as const) {
  test(`[${language}] thanh trên cùng và thanh công cụ timeline không tràn ra ngoài cửa sổ`, async () => {
    await page.locator('.top-bar select').first().selectOption(language)
    await page.waitForTimeout(200)
    expect(await escapees('.top-bar', 'button, select', { left: 0, right: 0 })).toEqual([])
    expect(await escapees('.timeline__toolbar', 'button, select', { left: 0, right: 0 })).toEqual(
      []
    )
    expect(
      await escapees('.media-library__toolbar', 'button, .media-library__search', {
        left: 0,
        right: 0
      })
    ).toEqual([])
  })

  test(`[${language}] panel thuộc tính: không ô nào tràn, nút không dính mép`, async () => {
    await page
      .locator('.timeline-lane--video .timeline-clip')
      .first()
      .click({ position: { x: 30, y: 20 } })
    for (const tab of ['Basic', 'Video', 'Audio', 'Animation']) {
      await page.getByRole('tab', { name: tab, exact: true }).click()
      await page.waitForTimeout(150)
      expect(
        await escapees('.inspector', 'select, input, .inspector__hint, .field-row', {
          left: 0,
          right: 0
        }),
        `tab ${tab}`
      ).toEqual([])
      expect(
        await escapees('.inspector', '.inspector__actions button', { left: 8, right: 0 }),
        `tab ${tab}: nút`
      ).toEqual([])
      expect(
        await escapees(
          '.inspector',
          '.inspector__hint, .field-row',
          { left: 8, right: 0 },
          'content'
        ),
        `tab ${tab}: chữ`
      ).toEqual([])
    }
  })

  test(`[${language}] chữ trong hộp thoại không dính mép`, async () => {
    const t = language === 'vi'
    const dialogText =
      '.dialog-note, .field-group__title, .export-dialog__hint, .project-versions__item, .keyboard-shortcuts__row, .field-row, .notice'
    const check = async (label: string): Promise<void> => {
      expect(
        await escapees('.export-dialog__body', dialogText, { left: 12, right: 8 }, 'content'),
        label
      ).toEqual([])
    }

    await page
      .locator('.timeline-lane--video .timeline-clip')
      .first()
      .click({ position: { x: 30, y: 20 } })
    await page.getByRole('button', { name: t ? 'Cắt khoảng lặng' : 'Cut silences' }).click()
    await page.getByRole('button', { name: t ? 'Dò khoảng lặng' : 'Detect silences' }).click()
    await page.locator('.export-dialog__body [role="status"]').waitFor()
    await check('cắt khoảng lặng')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t ? 'Đóng' : 'Close', exact: true })
      .click()

    await page.keyboard.press('?')
    await page.locator('.keyboard-shortcuts').waitFor()
    await check('phím tắt')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: t ? 'Phiên bản' : 'Versions' }).click()
    await page
      .getByRole('button', { name: t ? 'Lưu phiên bản ngay' : 'Save a version now' })
      .click()
    await page.locator('.project-versions__item').first().waitFor()
    await check('phiên bản')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t ? 'Đóng' : 'Close', exact: true })
      .click()

    await page
      .getByRole('button', { name: t ? 'Xuất video' : 'Export' })
      .first()
      .click()
    await page.getByLabel(t ? 'Mẫu xuất' : 'Preset').selectOption('vertical-short')
    await check('xuất video')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: t ? 'Đóng' : 'Close', exact: true })
      .click()
  })
}
