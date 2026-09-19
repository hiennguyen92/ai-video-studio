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
 * Làm sạch giọng, cắt khoảng lặng qua agent, và chuẩn hoá độ to khi xuất — chạy
 * thật trong app, trên footage "nói" (tiếng 300 Hz ở 1–2 s và 3–4 s) lẫn nhiễu
 * trắng và tiếng ù 50 Hz.
 *
 * Kết quả kiểm bằng project.json trên đĩa và bằng chính ffmpeg đo file xuất ra:
 * độ to là thứ tai không phân biệt nổi vài dB, chỉ phép đo mới nói được.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let ffmpegPath: string
let mcpUrl: string
let mcpToken: string

test.describe.configure({ mode: 'serial' })

interface SavedClip {
  id: string
  assetId: string
  startUs: number
  durationUs: number
  volume: number
  linkGroupId?: string
}

interface SavedDocument {
  tracks: Array<{ kind: string; name: string; role?: string; clips: SavedClip[] }>
  assets: Array<{ id: string; source: { path: string }; generated?: { task: string } }>
}

async function saved(): Promise<SavedDocument> {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as SavedDocument
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

/** Độ to tích hợp (LUFS) của file, đo bằng ffmpeg `ebur128`. */
async function integratedLufs(path: string): Promise<number> {
  const { stderr } = await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-vn',
    '-af',
    'ebur128',
    '-f',
    'null',
    '-'
  ])
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'))
  return Number(/I:\s*(-?[0-9.]+) LUFS/.exec(summary)![1])
}

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })
const videoClip = (): ReturnType<Page['locator']> =>
  page.locator('.timeline-lane--video .timeline-clip').first()

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-polish-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-polish-work-'))
  const video = join(workDir, 'phong-on.mp4')
  ffmpegPath = String((await import('ffmpeg-static')).default)

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='0.4*sin(2*PI*300*t)*(between(t,1,2)+between(t,3,4))+0.05*sin(2*PI*50*t)':s=48000:d=5",
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=white:amplitude=0.03:sample_rate=48000:duration=5',
    '-filter_complex',
    '[1][2]amix=inputs=2:normalize=0[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
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

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án làm sạch')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })
  await page.locator('.media-card').first().dblclick()
  await expect(videoClip()).toBeVisible()
  await page.getByRole('button', { name: 'Vừa khung' }).click()

  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio().getByRole('tab', { name: 'MCP', exact: true }).click()
  mcpUrl = await page.getByLabel('Địa chỉ', { exact: true }).inputValue()
  mcpToken = await page.getByLabel('Khoá truy cập', { exact: true }).inputValue()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

test('làm sạch giọng ở tab Audio: thêm tiếng sạch ở lane lời thoại, tắt tiếng gốc, gộp nhóm', async () => {
  await videoClip().click({ position: { x: 30, y: 20 } })
  await page.getByRole('tab', { name: 'Audio', exact: true }).click()
  await page.getByLabel('Mức', { exact: true }).selectOption('strong')
  await page.getByRole('button', { name: 'Làm sạch', exact: true }).click()
  await expect(page.getByText('Đã làm sạch giọng')).toBeVisible({ timeout: 60_000 })

  const document = await saved()
  const video = document.tracks.find((track) => track.kind === 'video')!.clips[0]
  const lane = document.tracks.find((track) => track.name === 'Giọng đã làm sạch')!
  expect(lane).toMatchObject({ kind: 'audio', role: 'dialogue' })
  const partner = lane.clips[0]

  expect(video.volume).toBe(0)
  expect(partner.linkGroupId).toBeTruthy()
  expect(partner.linkGroupId).toBe(video.linkGroupId)
  expect([partner.startUs, partner.durationUs]).toEqual([video.startUs, video.durationUs])

  const cleaned = document.assets.find((asset) => asset.id === partner.assetId)!
  expect(cleaned.generated?.task).toBe('voice-cleanup')
  expect(cleaned.source.path).toMatch(/-voice-strong\.flac$/)
})

test('agent đổi mức làm sạch qua MCP: thay tiếng sạch cũ, không thêm lane', async () => {
  const before = await saved()
  const videoId = before.tracks.find((track) => track.kind === 'video')!.clips[0].id
  const client = await connect()
  const reply = textOf(
    await client.callTool({
      name: 'clean_voice',
      arguments: { clipId: videoId, strength: 'light' }
    })
  )
  await client.close()
  expect(reply).toContain('Làm sạch giọng (light)')

  const after = await saved()
  expect(after.tracks).toHaveLength(before.tracks.length)
  const partner = after.tracks.find((track) => track.name === 'Giọng đã làm sạch')!.clips
  expect(partner).toHaveLength(1)
  const asset = after.assets.find((item) => item.id === partner[0].assetId)!
  expect(asset.source.path).toMatch(/-voice-light\.flac$/)
})

test('agent cắt khoảng lặng qua MCP: hình và tiếng sạch co cùng nhau, không lệch', async () => {
  const before = await saved()
  const videoId = before.tracks.find((track) => track.kind === 'video')!.clips[0].id
  const client = await connect()
  const reply = textOf(
    await client.callTool({
      name: 'remove_silences',
      // Nhiễu mẫu thử rất nặng: sau khi lọc nhẹ, đỉnh nhiễu vẫn ở -29,8 dB — sát
      // ngưỡng -30. -25 dB vẫn thấp hơn xa đỉnh tiếng nói (khoảng -8 dB).
      arguments: { clipId: videoId, thresholdDb: -25 }
    })
  )
  await client.close()
  expect(reply).toMatch(/Cắt \d+ khoảng lặng/)

  const after = await saved()
  const total = (clips: SavedClip[]): number =>
    clips.reduce((sum, clip) => sum + clip.durationUs, 0)
  const videoTotal = total(after.tracks.find((track) => track.kind === 'video')!.clips)
  const voiceTotal = total(after.tracks.find((track) => track.name === 'Giọng đã làm sạch')!.clips)

  // 5 s lời nói xen im; còn lại quanh hai đoạn nói 1 s cộng phần chừa lại.
  expect(videoTotal).toBeLessThan(3_500_000)
  expect(videoTotal).toBeGreaterThan(2_000_000)
  // Hai lane co ĐÚNG như nhau — lệch là khẩu hình trễ tiếng.
  expect(voiceTotal).toBe(videoTotal)
})

test('xuất qua MCP chuẩn hoá độ to về -14 LUFS theo mặc định', async () => {
  const outputPath = join(workDir, 'ra.mp4')
  const client = await connect()
  const started = textOf(
    await client.callTool({ name: 'start_export', arguments: { outputPath, scale: 'quarter' } })
  )
  expect(started).toContain('loudness=-14 LUFS')
  const jobId = /jobId=(\S+)/.exec(started)![1]

  let status = ''
  await expect
    .poll(
      async () => {
        status = textOf(await client.callTool({ name: 'get_export_status', arguments: { jobId } }))
        return /status=(\w+)/.exec(status)?.[1]
      },
      { timeout: 120_000, intervals: [500] }
    )
    .not.toBe('running')
  await client.close()
  expect(status).toContain('status=succeeded')

  expect(Math.abs((await integratedLufs(outputPath)) - -14)).toBeLessThan(1)
})

test('hộp thoại Xuất bật -14 LUFS sẵn, và chọn Tắt thì file ra giữ nguyên độ to', async () => {
  const outputPath = join(workDir, 'khong-chuan-hoa.mp4')
  // Mẫu thử sau khi làm sạch tình cờ nằm gần -14 LUFS; hạ tiếng xuống hẳn để
  // "không chuẩn hoá" và "chuẩn hoá" cho ra hai con số khác nhau rõ ràng.
  const voice = (await saved()).tracks.find((track) => track.name === 'Giọng đã làm sạch')!
  const client = await connect()
  for (const clip of voice.clips) {
    await client.callTool({ name: 'set_clip_volume', arguments: { clipId: clip.id, volume: 0.1 } })
  }
  await client.close()
  await saved()

  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, outputPath)

  await page.getByRole('button', { name: 'Xuất video' }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Xuất video' })
  const loudness = dialog.getByLabel('Chuẩn hoá âm lượng')
  await expect(loudness).toHaveValue('-14')

  // Lựa chọn phải thật sự đi tới lệnh xuất — không chỉ đổi trên ô chọn.
  await loudness.selectOption('off')
  await dialog.getByRole('button', { name: 'Chọn nơi lưu…' }).click()
  await dialog.getByRole('button', { name: 'Bắt đầu xuất' }).click()
  await expect(dialog.getByText('Xuất xong')).toBeVisible({ timeout: 120_000 })
  await dialog.getByRole('button', { name: 'Đóng' }).click()

  expect(Math.abs((await integratedLufs(outputPath)) - -14)).toBeGreaterThan(2)
})
