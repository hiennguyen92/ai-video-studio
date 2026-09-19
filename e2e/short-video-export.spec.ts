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
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

/**
 * Vòng "xuất video ngắn", chạy thật trong app: nền mờ cho cảnh ngang trong khung
 * dọc, mẫu xuất, xuất một đoạn theo marker, và ảnh PNG tại đầu phát.
 *
 * Nền mờ kiểm bằng ĐIỂM ẢNH của ảnh xuất ra: dải trên cùng của khung 9:16 nằm
 * ngoài cảnh ngang, không có nền thì đen kịt, có nền thì sáng lên. Đoạn xuất
 * kiểm bằng thời lượng thật của file do ffprobe đọc.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let ffmpegPath: string
let ffprobePath: string
let mcpUrl: string
let mcpToken: string

test.describe.configure({ mode: 'serial' })

async function saved(): Promise<{
  settings: { aspectRatio: string; width: number; height: number }
  tracks: Array<{ kind: string; clips: Array<{ id: string; backgroundFill?: unknown }> }>
  markers: Array<{ id: string; atUs: number }>
}> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8'))
}

async function connect(): Promise<Client> {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { 'x-avs-token': mcpToken } }
    })
  )
  return client
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((item) => item.text ?? '').join('\n')
}

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await connect()
  try {
    return textOf(await client.callTool({ name, arguments: args }))
  } finally {
    await client.close()
  }
}

/** Kích thước và thời lượng (giây) của file, do ffprobe đọc. */
async function probe(path: string): Promise<{ width: number; height: number; duration: number }> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:format=duration',
    '-of',
    'json',
    path
  ])
  const data = JSON.parse(stdout) as {
    streams: Array<{ width: number; height: number }>
    format: { duration?: string }
  }
  return {
    width: data.streams[0].width,
    height: data.streams[0].height,
    duration: Number(data.format.duration ?? 0)
  }
}

/** Độ sáng trung bình (0–255) của dải trên cùng cao `bandHeight` px. */
async function topBandLuma(path: string, bandHeight: number): Promise<number> {
  // `metadata=print:file=-` ghi số đo ra stdout, tách khỏi nhật ký của ffmpeg.
  const { stdout } = await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-v',
    'error',
    '-i',
    path,
    '-vf',
    `crop=iw:${bandHeight}:0:0,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`,
    '-f',
    'null',
    '-'
  ])
  return Number(/YAVG=([0-9.]+)/.exec(stdout)![1])
}

const videoClip = (): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').first()
const exportDialog = (): ReturnType<Page['getByRole']> =>
  page.getByRole('dialog', { name: 'Xuất video' })

async function stubSaveDialog(path: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, path)
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-short-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-short-work-'))
  const video = join(workDir, 'canh-ngang.mp4')
  ffmpegPath = String((await import('ffmpeg-static')).default)
  ffprobePath = (await import('@ffprobe-installer/ffprobe')).path

  // Cảnh NGANG sáng màu, có tiếng: đặt vào khung dọc thì trên và dưới trống.
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=6',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án video ngắn')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  const studio = page.getByRole('region', { name: 'AI Studio' })
  await studio.getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(videoClip()).toBeVisible()
  await page.getByRole('button', { name: 'Vừa khung' }).click()

  await studio.getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio.getByRole('tab', { name: 'MCP', exact: true }).click()
  mcpUrl = await page.getByLabel('Địa chỉ', { exact: true }).inputValue()
  mcpToken = await page.getByLabel('Khoá truy cập', { exact: true }).inputValue()

  // Khung dọc 1080×1920, như một dự án TikTok.
  expect(await callTool('set_canvas', { aspect: '9:16' })).not.toContain('Bị từ chối')
  expect((await saved()).settings).toMatchObject({ aspectRatio: '9:16', width: 1080 })
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

test('nền mờ lấp hai dải đen của cảnh ngang trong khung dọc — đo bằng điểm ảnh', async () => {
  // Cảnh 640×360 trong khung 1080×1920 chiếm ~607 px giữa khung: 300 px trên cùng
  // hoàn toàn nằm ngoài cảnh.
  const without = join(workDir, 'khong-nen.png')
  expect(await callTool('export_frame', { atSeconds: 1, outputPath: without })).toContain(
    'Đã lưu ảnh'
  )
  expect(await probe(without)).toMatchObject({ width: 1080, height: 1920 })
  const blackLuma = await topBandLuma(without, 300)
  expect(blackLuma).toBeLessThan(20)

  await videoClip().click({ position: { x: 30, y: 20 } })
  await page.getByRole('tab', { name: 'Video', exact: true }).click()
  await page.getByLabel('Nền mờ', { exact: true }).check()
  expect(
    (await saved()).tracks.find((track) => track.kind === 'video')!.clips[0].backgroundFill
  ).toEqual({ kind: 'blur', amount: 0.5 })

  const withFill = join(workDir, 'co-nen.png')
  expect(await callTool('export_frame', { atSeconds: 1, outputPath: withFill })).toContain(
    'Đã lưu ảnh'
  )
  const filledLuma = await topBandLuma(withFill, 300)
  expect(filledLuma).toBeGreaterThan(blackLuma + 25)
})

test('nút PNG trong hộp thoại Xuất lưu khung tại đầu phát đúng cỡ đã chọn', async () => {
  const pngPath = join(workDir, 'anh-bia.png')
  await stubSaveDialog(pngPath)
  await page.getByRole('button', { name: 'Xuất video' }).first().click()
  await exportDialog().getByLabel('Độ phân giải').selectOption('half')
  await exportDialog().getByRole('button', { name: 'Lưu khung PNG tại đầu phát' }).click()
  await expect(exportDialog().getByText('Đã lưu ảnh anh-bia.png')).toBeVisible({
    timeout: 120_000
  })
  expect(await probe(pngPath)).toMatchObject({ width: 540, height: 960 })
  await exportDialog().getByRole('button', { name: 'Đóng' }).click()
})

test('mẫu TikTok điền sẵn các ô; mẫu YouTube báo lệch khung', async () => {
  await page.getByRole('button', { name: 'Xuất video' }).first().click()
  const dialog = exportDialog()
  await dialog.getByLabel('Mẫu xuất').selectOption('vertical-short')
  await expect(dialog.getByLabel('Chất lượng')).toHaveValue('high')
  await expect(dialog.getByLabel('Chuẩn hoá âm lượng')).toHaveValue('-14')
  await expect(dialog.getByLabel('Độ phân giải')).toHaveValue('full')
  await expect(dialog.getByText(/Mẫu này cần khung/)).toHaveCount(0)

  await dialog.getByLabel('Mẫu xuất').selectOption('youtube')
  await expect(
    dialog.getByText('Mẫu này cần khung 16:9, dự án đang là 9:16', { exact: false })
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Đóng' }).click()
})

test('xuất đúng đoạn giữa hai marker: file dài đúng đoạn đó', async () => {
  // Marker ở 0 s và 2 s → đoạn thứ hai chạy từ 2 s tới hết video (6 s).
  await page.keyboard.press('Home')
  await page.keyboard.press('m')
  for (let step = 0; step < 6; step += 1) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('m')
  const markers = (await saved()).markers.sort((a, b) => a.atUs - b.atUs)
  expect(markers.map((marker) => marker.atUs)).toEqual([0, 2_000_000])

  const outputPath = join(workDir, 'doan-2.mp4')
  await stubSaveDialog(outputPath)
  await page.getByRole('button', { name: 'Xuất video' }).first().click()
  const dialog = exportDialog()
  await dialog.getByLabel('Độ phân giải').selectOption('quarter')
  await dialog.getByLabel('Đoạn xuất').selectOption(`marker:${markers[1].id}`)
  await dialog.getByLabel('Chất lượng').selectOption('compact')
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 180_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  const file = await probe(outputPath)
  expect(file).toMatchObject({ width: 270, height: 480 })
  expect(Math.abs(file.duration - 4)).toBeLessThan(0.2)
})

test('agent xuất một đoạn theo giây qua MCP', async () => {
  const outputPath = join(workDir, 'agent-doan.mp4')
  const client = await connect()
  const started = textOf(
    await client.callTool({
      name: 'start_export',
      arguments: {
        outputPath,
        scale: 'quarter',
        fromSeconds: 1,
        toSeconds: 2.5,
        quality: 'compact'
      }
    })
  )
  const jobId = /jobId=(\S+)/.exec(started)![1]
  let status = ''
  await expect
    .poll(
      async () => {
        status = textOf(await client.callTool({ name: 'get_export_status', arguments: { jobId } }))
        return /status=(\w+)/.exec(status)?.[1]
      },
      { timeout: 180_000, intervals: [500] }
    )
    .not.toBe('running')
  await client.close()
  expect(status).toContain('status=succeeded')
  expect(Math.abs((await probe(outputPath)).duration - 1.5)).toBeLessThan(0.2)
})
