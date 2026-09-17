import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

/**
 * Thứ tự lớp đi theo thứ tự lane trên timeline.
 *
 * Lane trên cùng vẽ trước nên nằm dưới; lane dưới cùng vẽ sau nên nằm trên. Một
 * luật cho cả hình, ảnh, phụ đề và chữ.
 *
 * Trước đây thứ tự cứng trong lớp vẽ: hình, rồi phụ đề, rồi chữ — chữ luôn nằm
 * trên bất kể xếp lane thế nào, nên kéo lane cũng không đổi được gì.
 */

const execFileAsync = promisify(execFile)

test('lane thêm sau nằm TRÊN lane thêm trước', async () => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'avs-layer-'))
  const workDir = await mkdtemp(join(tmpdir(), 'avs-layer-w-'))
  const image = join(workDir, 'nen.png')
  const { default: ffmpegStatic } = await import('ffmpeg-static')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=#00FF66:size=1200x1200',
    '-frames:v',
    '1',
    image
  ])

  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, image)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Thứ tự lớp')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  const timeline = page.getByRole('region', { name: 'Timeline' })
  await timeline.waitFor()

  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })

  // Lane CHỮ trước, rồi lane ẢNH — nên ảnh nằm dưới danh sách, tức vẽ sau.
  await timeline.getByRole('button', { name: 'Thêm track Text' }).click()
  await page.getByRole('region', { name: 'AI Studio' }).getByRole('tab', { name: 'Phụ đề' }).click()
  await page.getByRole('button', { name: 'Thêm chữ' }).click()
  await page.getByLabel('Nội dung 1').fill('BỊ CHE')
  await page.getByLabel('Bắt đầu (giây) 1').fill('0')
  await page.getByLabel('Kết thúc (giây) 1').fill('4')

  await timeline.getByRole('button', { name: 'Thêm track hình ảnh' }).click()
  // Quay lại tab Media: thư viện bị ẩn khi đang ở tab Phụ đề.
  await page.getByRole('region', { name: 'AI Studio' }).getByRole('tab', { name: 'Media' }).click()
  await page.locator('.media-card').first().dblclick()
  await page.waitForTimeout(800)

  const hitAtText = async (): Promise<string> =>
    page.evaluate(() => {
      const span = document.querySelector('.text-overlay .text-block span') as HTMLElement | null
      if (!span) return 'không có chữ'
      const rect = span.getBoundingClientRect()
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      if (!at) return 'không trúng gì'
      if (at === span || span.contains(at)) return 'chữ'
      return at.tagName.toLowerCase()
    })

  // Chữ vẫn còn trong DOM — nó bị CHE, không phải bị xoá.
  await expect(page.locator('.text-overlay')).toContainText('BỊ CHE')
  expect(await hitAtText()).toBe('img')

  // Đảo lại: xoá lane ảnh thì chữ hiện lên trở lại.
  await page
    .locator('.track-head')
    .filter({ hasText: 'Hình ảnh 1' })
    .getByRole('button', { name: 'Xoá track' })
    .click()
  await page.waitForTimeout(500)
  expect(await hitAtText()).toBe('chữ')

  await app.close()
  await rm(userDataDir, { recursive: true, force: true })
  await rm(workDir, { recursive: true, force: true })
})
