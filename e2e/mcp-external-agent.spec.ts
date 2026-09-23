import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
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
import { chatToolSchemas } from '../src/shared/ai/chat-tool-catalog'

/**
 * Agent bên ngoài dựng phim qua MCP — chạy bằng CLIENT MCP THẬT.
 *
 * Đây là phép thử cho toàn bộ lý do MCP tồn tại: một tiến trình khác (ở đây đóng
 * vai Claude Code) nối vào app đang chạy, ĐỌC dự án và transcript, rồi DỰNG một
 * bản cut — và bản cut đó phải xuất hiện thật trên timeline.
 *
 * Không giả lập gì: client MCP thật, HTTP thật, app Electron thật, và kết quả
 * được kiểm bằng chính project.json trên đĩa.
 */

const execFileAsync = promisify(execFile)

let app: ElectronApplication
let page: Page
let userDataDir: string
let workDir: string
let mediaPath: string
let mcpUrl: string
let mcpToken: string

test.describe.configure({ mode: 'serial' })

async function connect(token = mcpToken): Promise<Client> {
  const client = new Client({ name: 'e2e-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpUrl), {
      requestInit: { headers: { 'x-avs-token': token } }
    })
  )
  return client
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? []
  return content.map((item) => item.text ?? '').join('\n')
}

async function savedDocument(): Promise<{
  tracks: Array<{
    id: string
    kind: string
    clips: Array<{ startUs: number; durationUs: number; sourceInUs: number }>
  }>
  name: string
}> {
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  return JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as Awaited<ReturnType<typeof savedDocument>>
}

test.beforeAll(async () => {
  userDataDir = await mkdtemp(join(tmpdir(), 'avs-mcp-'))
  workDir = await mkdtemp(join(tmpdir(), 'avs-mcp-work-'))
  mediaPath = join(workDir, 'canh-quay.mp4')

  const { default: ffmpegStatic } = await import('ffmpeg-static')
  // Bốn cú máy màu khác nhau, KHÔNG TIẾNG — đúng loại footage quay review sản
  // phẩm, nơi transcript rỗng và agent phải chọn cảnh bằng hình.
  const parts: string[] = []
  for (const [index, color] of ['red', 'blue', 'green', 'yellow'].entries()) {
    const part = join(workDir, `part-${index}.mp4`)
    await execFileAsync(String(ffmpegStatic), [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=320x180:rate=30:duration=3`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      part
    ])
    parts.push(`file '${part}'`)
  }
  const listPath = join(workDir, 'list.txt')
  await writeFile(listPath, parts.join('\n'), 'utf8')
  await execFileAsync(String(ffmpegStatic), [
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    mediaPath
  ])

  app = await electron.launch({
    args: ['.'],
    env: { ...process.env, AVS_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' }
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, mediaPath)

  await page.getByPlaceholder('Ví dụ: Video giới thiệu sản phẩm').fill('Dự án MCP')
  await page.getByRole('button', { name: 'Tạo dự án mới' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true })
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

const studio = (): ReturnType<Page['getByRole']> => page.getByRole('region', { name: 'AI Studio' })

test('app công bố địa chỉ và khoá MCP để cấu hình agent', async () => {
  await studio().getByRole('tab', { name: 'Cấu hình AI' }).click()
  await studio().getByRole('tab', { name: 'MCP', exact: true }).click()

  const address = page.getByLabel('Địa chỉ', { exact: true })
  await expect(address).toBeVisible()
  mcpUrl = await address.inputValue()
  mcpToken = await page.getByLabel('Khoá truy cập', { exact: true }).inputValue()

  // Chỉ nghe trên máy này — cổng cục bộ sửa được dự án nên không được mở ra ngoài.
  expect(mcpUrl).toContain('127.0.0.1')
  expect(mcpUrl).toContain('/api/external-mcp/mcp')
  expect(mcpToken.length).toBeGreaterThan(20)
})

test('từ chối kết nối không có khoá đúng', async () => {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-avs-token': 'khoa-sai' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
  })
  expect(response.status).toBe(401)
})

test('agent liệt kê được công cụ dựng phim', async () => {
  const client = await connect()
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name)

  // Nhóm đọc — không có thì agent dựng mù.
  expect(names).toContain('get_project_overview')
  expect(names).toContain('get_transcript')
  expect(names).toContain('list_media')
  expect(names).toContain('get_translation')
  // Hoàn tác riêng của MCP — agent bên ngoài không có phím Cmd+Z.
  expect(names).toContain('undo')
  expect(names).toContain('redo')
  expect(names).toContain('start_export')
  expect(names).toContain('get_export_status')
  expect(names).toContain('cancel_export')
  // Nhóm dựng — sinh từ chính danh mục của AI Chat trong app.
  //
  // Kiểm ĐỦ chứ không kiểm vài cái: máy chủ MCP đổi từng schema Zod sang JSON
  // Schema lúc đăng ký, và một schema mà bộ SDK không đổi được sẽ rơi ra khỏi
  // danh sách mà không báo gì — công cụ có trong app nhưng agent không gọi được.
  const missing = Object.keys(chatToolSchemas).filter((name) => !names.includes(name))
  expect(missing).toEqual([])
  // Chuyển cảnh đặt theo chỗ nối giữa hai clip, cùng mô hình với timeline; công cụ
  // cũ đặt trên từng clip đã bỏ.
  expect(names).toContain('set_cut_transition')
  expect(names).not.toContain('set_clip_transition')

  await client.close()
})

test('agent đọc được dự án và thư viện media', async () => {
  await studio().getByRole('tab', { name: 'Media' }).click()
  await studio().getByRole('button', { name: 'Nhập media' }).first().click()
  await page.locator('.media-card').first().waitFor({ timeout: 90_000 })

  const client = await connect()

  const overview = textOf(await client.callTool({ name: 'get_project_overview', arguments: {} }))
  expect(overview).toContain('Dự án MCP')
  // Dòng tiêu đề nói luôn ý nghĩa của thứ tự lane; agent cần biết lane nào vẽ
  // trên lane nào mới đặt được logo lên trên cảnh quay.
  expect(overview).toContain('Tracks (index 0 is the top lane')

  const media = textOf(await client.callTool({ name: 'list_media', arguments: {} }))
  expect(media).toContain('canh-quay.mp4')
  // Đường dẫn ảnh phải lộ ra để agent xem được hình mà chọn cảnh.
  expect(media).toContain('thumbnail=')

  await client.close()
})

test('agent DỰNG được bản cut từ transcript, và nó hiện lên timeline thật', async () => {
  // Nạp transcript qua file dự án — phiên âm thật đã có nhóm test riêng.
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  await page.getByRole('button', { name: 'Về danh sách dự án' }).click()

  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  const documentFile = join(projectsRoot, projectId, 'project.json')
  const document = JSON.parse(await readFile(documentFile, 'utf8')) as {
    assets: Array<{ id: string }>
    transcripts: unknown[]
    revision: number
  }
  document.transcripts = [
    {
      id: 'tr_mcp',
      assetId: document.assets[0].id,
      language: 'vi',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: new Date().toISOString(),
      segments: [
        { id: 'g1', startUs: 1_000_000, endUs: 3_000_000, text: 'Mở đầu giật gân', edited: false },
        { id: 'g2', startUs: 5_000_000, endUs: 6_000_000, text: 'Đoạn thừa', edited: false },
        { id: 'g3', startUs: 9_000_000, endUs: 12_000_000, text: 'Chốt đơn', edited: false }
      ]
    }
  ]
  document.revision += 1
  await writeFile(documentFile, JSON.stringify(document), 'utf8')
  await page.locator('.project-card__open', { hasText: 'Dự án MCP' }).click()
  await page.getByRole('region', { name: 'Timeline' }).waitFor()

  const client = await connect()

  // Agent đọc transcript để biết giữ đoạn nào.
  const transcript = textOf(await client.callTool({ name: 'get_transcript', arguments: {} }))
  expect(transcript).toContain('Mở đầu giật gân')
  expect(transcript).toContain('id=g3')

  // Rồi dựng bản cut — bỏ đoạn thừa ở giữa.
  const built = textOf(
    await client.callTool({
      name: 'build_cut_from_transcript',
      arguments: { keepSegmentIds: ['g1', 'g3'] }
    })
  )
  expect(built).toContain('Đã áp dụng')
  expect(built).toContain('2 đoạn')

  // Bằng chứng: timeline của app đổi thật.
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
  await client.close()
})

test('agent áp được kiểu dựng, đúng thẻ mà người dùng bấm trong Library', async () => {
  // Agent vốn gọi được từng công cụ lẻ để làm y hệt. Cái nó không có là bộ giá
  // trị đã chọn sẵn — không có công cụ này thì được bảo "làm video ngắn dọc" nó
  // sẽ tự bịa một cách dựng khác với cái thẻ trong app.
  const client = await connect()

  const applied = textOf(
    await client.callTool({
      name: 'apply_edit_style',
      arguments: { styleId: 'vertical-short' }
    })
  )
  expect(applied).toContain('Đã áp dụng')
  expect(applied).toContain('vertical-short')

  // Bằng chứng: dự án của app đổi thật, không chỉ là chữ trả về.
  const projectsRoot = join(userDataDir, 'projects')
  const [projectId] = await readdir(projectsRoot)
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const document = JSON.parse(
    await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
  ) as {
    settings: { aspectRatio: string }
    tracks: Array<{ kind: string; clips: Array<{ motion?: { kind: string } }> }>
  }
  expect(document.settings.aspectRatio).toBe('9:16')
  const clips = document.tracks.find((track) => track.kind === 'video')!.clips
  expect(clips.every((clip) => clip.motion?.kind === 'punch-in')).toBe(true)

  // Cả kiểu dựng gộp thành MỘT bước hoàn tác, y như khi bấm thẻ trong app.
  const undone = textOf(await client.callTool({ name: 'undo', arguments: {} }))
  expect(undone).toContain('Đã hoàn tác')
  await client.close()

  // Chờ có điều kiện: hoàn tác xong thì app mới ghi file, đọc ngay là đọc trúng
  // bản cũ và phép thử đỏ vì lý do chẳng liên quan gì tới cái đang kiểm.
  await expect
    .poll(
      async () => {
        const after = JSON.parse(
          await readFile(join(projectsRoot, projectId, 'project.json'), 'utf8')
        ) as { tracks: Array<{ kind: string; clips: Array<{ motion?: unknown }> }> }
        return after.tracks
          .find((track) => track.kind === 'video')!
          .clips.some((clip) => clip.motion)
      },
      { timeout: 15_000 }
    )
    .toBe(false)
})

test('bản dựng của agent hoàn tác được như mọi thao tác tay', async () => {
  await page.keyboard.press('ControlOrMeta+z')
  await expect(page.locator('.timeline-clip')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(page.locator('.timeline-clip')).toHaveCount(2)
})

test('agent tự hoàn tác và làm lại được qua MCP', async () => {
  const client = await connect()

  const undone = textOf(await client.callTool({ name: 'undo', arguments: {} }))
  expect(undone).toContain('Đã hoàn tác: MCP:')
  await expect(page.locator('.timeline-clip')).toHaveCount(0)

  const redone = textOf(await client.callTool({ name: 'redo', arguments: {} }))
  expect(redone).toContain('Đã làm lại: MCP:')
  await expect(page.locator('.timeline-clip')).toHaveCount(2)

  await client.close()
})

test('agent sửa được chữ transcript và đọc lại thấy chữ mới', async () => {
  const client = await connect()

  const fixed = textOf(
    await client.callTool({
      name: 'update_transcript_segment',
      arguments: { transcriptId: 'tr_mcp', segmentId: 'g3', text: 'Chốt đơn ngay' }
    })
  )
  expect(fixed).toContain('Đã áp dụng')
  const transcript = textOf(await client.callTool({ name: 'get_transcript', arguments: {} }))
  expect(transcript).toContain('id=g3 9.00s–12.00s: Chốt đơn ngay')

  // Trả lại như cũ để các bước sau không phụ thuộc vào phép thử này.
  expect(textOf(await client.callTool({ name: 'undo', arguments: {} }))).toContain('Đã hoàn tác')
  await client.close()
})

test('bản dựng được lưu vào dự án với đúng mốc thời gian', async () => {
  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const saved = await savedDocument()

  const clips = saved.tracks.flatMap((track) => track.clips)
  expect(clips).toHaveLength(2)
  // Đoạn 1 dài 2s, đoạn 3 dài 3s, nối sát nhau từ 0.
  expect(clips.map((clip) => [clip.startUs, clip.durationUs, clip.sourceInUs])).toEqual([
    [0, 2_000_000, 1_000_000],
    [2_000_000, 3_000_000, 9_000_000]
  ])
})

test('agent bị chặn khi bịa id, và dự án không đổi', async () => {
  const before = await savedDocument()
  const client = await connect()

  const result = textOf(
    await client.callTool({
      name: 'build_cut_from_transcript',
      arguments: { keepSegmentIds: ['khong_co_that'] }
    })
  )
  expect(result).toContain('Bị từ chối')
  expect(result).toContain('Không tìm thấy đoạn')

  await expect(page.locator('.timeline-clip')).toHaveCount(2)
  const after = await savedDocument()
  expect(after.tracks.flatMap((track) => track.clips)).toHaveLength(
    before.tracks.flatMap((track) => track.clips).length
  )

  await client.close()
})

test('agent cắt bỏ được một khoảng và dồn phần sau lên', async () => {
  const client = await connect()

  const result = textOf(
    await client.callTool({
      name: 'ripple_delete_range',
      arguments: { fromSeconds: 0, toSeconds: 1 }
    })
  )
  expect(result).toContain('Đã áp dụng')

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const saved = await savedDocument()
  const clips = saved.tracks.flatMap((track) => track.clips)

  // Cắt 1 giây đầu: clip đầu ngắn lại, clip sau lùi lên lấp chỗ trống.
  expect(clips[0].durationUs).toBe(1_000_000)
  expect(clips[1].startUs).toBe(1_000_000)

  await client.close()
})

test('agent dò được cú máy và XEM được ảnh đại diện của từng cú', async () => {
  const client = await connect()

  const shots = textOf(await client.callTool({ name: 'list_shots', arguments: {} }))
  expect(shots).toContain('shots=4')
  // Đường dẫn ảnh là thứ quan trọng nhất: có nó thì agent nhìn được cú máy mà
  // chọn, thay vì đoán mò theo mốc thời gian.
  expect(shots).toContain('frame=')

  const framePaths = [...shots.matchAll(/frame=(\S+)/g)].map((match) => match[1])
  expect(framePaths).toHaveLength(4)
  for (const framePath of framePaths) {
    expect((await stat(framePath)).size).toBeGreaterThan(0)
  }

  await client.close()
})

test('agent dựng bản cut từ cú máy đã chọn, theo ĐÚNG thứ tự nó muốn', async () => {
  const client = await connect()
  await client.callTool({ name: 'list_shots', arguments: {} })

  // Đảo thứ tự có chủ ý: với footage câm, xếp lại cảnh chính là việc dựng phim,
  // nên thứ tự agent đưa ra phải được tôn trọng — khác hẳn dựng theo lời nói.
  const assetId = /asset id=(\S+)/.exec(
    textOf(await client.callTool({ name: 'list_shots', arguments: {} }))
  )?.[1] as string

  const built = textOf(
    await client.callTool({
      name: 'build_cut_from_shots',
      arguments: { assetId, shotIndexes: [3, 0, 2], maxShotSeconds: 1.5 }
    })
  )
  expect(built).toContain('Đã áp dụng')
  expect(built).toContain('3 cú máy')

  await expect(page.locator('.timeline-clip')).toHaveCount(3)

  await expect(page.locator('.top-bar__status')).toHaveText('Đã lưu', { timeout: 15_000 })
  const saved = await savedDocument()
  const clips = saved.tracks.flatMap((track) => track.clips)

  // Mỗi cú bị cắt còn 1,5 giây và xếp sát nhau; sourceInUs phải theo đúng thứ
  // tự đảo mà agent yêu cầu: cú 3 (giây 9), cú 0 (giây 0), cú 2 (giây 6).
  expect(clips.map((clip) => [clip.startUs, clip.durationUs, clip.sourceInUs])).toEqual([
    [0, 1_500_000, 9_000_000],
    [1_500_000, 1_500_000, 0],
    [3_000_000, 1_500_000, 6_000_000]
  ])

  await client.close()
})

test('agent bị chặn khi chọn cú máy không tồn tại', async () => {
  const client = await connect()
  await client.callTool({ name: 'list_shots', arguments: {} })
  const assetId = /asset id=(\S+)/.exec(
    textOf(await client.callTool({ name: 'list_shots', arguments: {} }))
  )?.[1] as string

  const result = textOf(
    await client.callTool({
      name: 'build_cut_from_shots',
      arguments: { assetId, shotIndexes: [99] }
    })
  )
  expect(result).toContain('Bị từ chối')
  expect(result).toContain('Không có cú máy số')

  await client.close()
})

test('agent xuất được video qua MCP và theo dõi tới khi xong', async () => {
  const client = await connect()
  const outputPath = join(workDir, 'agent-xuat.mp4')

  // Đường dẫn tương đối vô nghĩa với app: agent chạy ở thư mục khác.
  const relative = textOf(
    await client.callTool({ name: 'start_export', arguments: { outputPath: 'x.mp4' } })
  )
  expect(relative).toContain('tuyệt đối')

  const started = textOf(
    await client.callTool({ name: 'start_export', arguments: { outputPath, scale: 'quarter' } })
  )
  const jobId = /jobId=(\S+)/.exec(started)?.[1]
  expect(jobId, started).toBeTruthy()

  // Hỏi lại như một agent thật: xuất mất thời gian, lời gọi đầu chỉ trả jobId.
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
  expect(status).toContain('status=succeeded')
  expect(status).toContain(`output=${outputPath}`)
  expect((await stat(outputPath)).size).toBeGreaterThan(0)

  // Không ghi đè ngầm bản xuất đã có.
  const again = textOf(await client.callTool({ name: 'start_export', arguments: { outputPath } }))
  expect(again).toContain('overwrite:true')

  await client.close()
})

/*
 * Để CUỐI file: phép thử này xáo thứ tự lane, mà những phép thử phía trên đọc
 * track theo chỉ số. Trả lại thứ tự cũ ở đây thì được, nhưng một bước dọn hụt sẽ
 * làm chúng đổ vì lý do chẳng liên quan gì tới thứ chúng kiểm.
 */
test('agent gọi được công cụ sắp lại thứ tự lane', async () => {
  // Thứ tự lane quyết định lớp nào che lớp nào, nên đây là công cụ agent cần khi
  // dựng: đặt logo lên trên cảnh quay.
  const client = await connect()
  const before = await savedDocument()
  const trackId = before.tracks[before.tracks.length - 1].id

  await client.callTool({ name: 'reorder_track', arguments: { trackId, toIndex: 0 } })

  await expect
    .poll(async () => (await savedDocument()).tracks[0].id, { timeout: 15_000 })
    .toBe(trackId)

  await client.close()
})
