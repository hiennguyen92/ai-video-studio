import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * Ba lỗi mất dữ liệu / ra sai file mà đợt soát mã tìm ra, chạy thật trong app:
 *
 * 1. Đóng cửa sổ khi ghi hỏng: trước đây đóng lặng lẽ, mất sửa đổi.
 * 2. Khôi phục bản CŨ NHẤT khi đã đủ 20 bản: bản dự phòng ghi trước đẩy mất chính
 *    bản đang khôi phục.
 * 3. Hai lần xuất qua MCP liền nhau, không nêu tên file: cùng chọn một tên.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let exportDir: string

test.describe.configure({ mode: 'serial' })

async function projectDir(): Promise<string> {
  const root = join(userDataDir, 'projects')
  const [id] = await readdir(root)
  return join(root, id)
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-safety-'))
  exportDir = await mkdtemp(join(tmpdir(), 'avs-safety-out-'))
  const video = join(userDataDir, 'canh.mp4')
  const ffmpegPath = String((await import('ffmpeg-static')).default)
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x90:rate=30:duration=2',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    video
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(
    ({ app: electronApp, dialog }, paths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.video] })
      // Thư mục Videos mặc định trỏ vào thư mục tạm của phép thử.
      electronApp.setPath('videos', paths.exportDir)
    },
    { video, exportDir }
  )
  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('An toàn')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await page
    .getByRole('region', { name: 'AI Studio' })
    .getByRole('button', { name: 'Nhập media' })
    .first()
    .click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
})

test.afterAll(async () => {
  if (userDataDir) await chmod(await projectDir(), 0o755).catch(() => undefined)
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (exportDir) await rm(exportDir, { recursive: true, force: true })
})

test('khôi phục bản cũ nhất khi đã đủ 20 bản tự động: khôi phục được, không tự xoá', async () => {
  // 20 bản tự động, bản đầu tiên đặt tên dự án khác để nhận ra.
  for (let index = 0; index < 20; index += 1) {
    await page.evaluate(
      async (label) => {
        const bridge = window as unknown as {
          api: { project: { snapshot(document: unknown): Promise<unknown> } }
        }
        // Lấy tài liệu hiện tại qua chính IPC của app.
        const list = await (
          window as unknown as {
            api: { project: { list(): Promise<{ ok: boolean; data: Array<{ id: string }> }> } }
          }
        ).api.project.list()
        const loaded = await (
          window as unknown as {
            api: {
              project: { load(id: string): Promise<{ ok: boolean; data: Record<string, unknown> }> }
            }
          }
        ).api.project.load(list.data[0].id)
        await bridge.api.project.snapshot({ ...loaded.data, name: label })
        await new Promise((resolve) => setTimeout(resolve, 5))
      },
      index === 0 ? 'Bản cũ nhất' : `Bản ${index}`
    )
  }

  await page.getByRole('button', { name: 'Phiên bản' }).click()
  const dialog = page.getByRole('dialog', { name: 'Phiên bản đã lưu' })
  await expect(dialog.locator('.project-versions__item')).toHaveCount(20)
  const oldest = dialog.locator('.project-versions__item').last()
  await oldest.getByRole('button', { name: 'Khôi phục' }).click()
  await oldest.getByRole('button', { name: 'Bấm lần nữa để khôi phục' }).click()
  // Trước đây: bản dự phòng ghi trước đẩy mất bản cũ nhất, và khôi phục báo lỗi ENOENT.
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.top-bar__title')).toHaveText('Bản cũ nhất')
})

test('hai lần xuất qua MCP liền nhau, không nêu tên: ra hai file khác nhau', async () => {
  const studio = page.getByRole('region', { name: 'AI Studio' })
  await studio.getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio.getByRole('tab', { name: 'MCP', exact: true }).click()
  const url = await page.getByLabel('Địa chỉ', { exact: true }).inputValue()
  const token = await page.getByLabel('Khoá truy cập', { exact: true }).inputValue()
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-avs-token': token } }
    })
  )
  const text = (result: unknown): string =>
    ((result as { content?: Array<{ text?: string }> }).content ?? [])
      .map((item) => item.text ?? '')
      .join('\n')

  const [first, second] = await Promise.all([
    client.callTool({ name: 'start_export', arguments: { scale: 'quarter', loudnessLufs: null } }),
    client.callTool({ name: 'start_export', arguments: { scale: 'quarter', loudnessLufs: null } })
  ])
  const outputs = [text(first), text(second)].map((reply) => /output=(.+)/.exec(reply)?.[1])
  expect(outputs[0]).toBeTruthy()
  expect(outputs[1]).toBeTruthy()
  // Trước đây: cả hai cùng "Bản cũ nhất.mp4", một bản ghi đè bản kia.
  expect(outputs[0]).not.toBe(outputs[1])

  for (const reply of [text(first), text(second)]) {
    const jobId = /jobId=(\S+)/.exec(reply)![1]
    await expect
      .poll(
        async () =>
          /status=(\w+)/.exec(
            text(await client.callTool({ name: 'get_export_status', arguments: { jobId } }))
          )?.[1],
        { timeout: 120_000, intervals: [500] }
      )
      .toBe('succeeded')
  }
  await client.close()
  expect((await readdir(exportDir)).filter((name) => name.endsWith('.mp4'))).toHaveLength(2)
})

test('đóng cửa sổ khi không ghi được: hỏi trước, bấm Huỷ thì cửa sổ ở lại', async () => {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  // Thư mục dự án chỉ đọc: lần ghi kế tiếp chắc chắn hỏng.
  await chmod(await projectDir(), 0o555)
  await page.locator('.timeline__body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('m')

  let asked = ''
  page.once('dialog', (prompt) => {
    asked = prompt.message()
    void prompt.dismiss()
  })
  // Gọi đóng từ main — đúng đường người dùng bấm nút đỏ.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await expect.poll(() => asked, { timeout: 15_000 }).toContain('Không lưu được dự án')
  await page.waitForTimeout(500)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

  await chmod(await projectDir(), 0o755)
})
