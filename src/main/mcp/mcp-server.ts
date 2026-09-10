import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { chatToolDescriptions, chatToolSchemas } from '../../shared/ai/chat-tool-catalog'
import type { ChatToolName } from '../../shared/ai/chat-tool-catalog'
import type { McpApplyResult, McpServerStatus } from '../../shared/ipc/ipc-contract'
import { isRendererAvailable, requestFromRenderer } from './mcp-renderer-bridge'
import { loadMcpConfig, mcpConfig, setMcpRequireToken } from './mcp-config-store'

/**
 * Máy chủ MCP để agent bên ngoài (Claude Code, Codex…) dựng phim trong app này.
 *
 * Điểm cốt lõi — và cũng là điều làm nó an toàn: **công cụ ở đây KHÔNG phải một
 * tập riêng.** Chúng sinh thẳng từ `chatToolSchemas`, đúng danh mục mà AI Chat
 * trong app dùng, và đi qua đúng `chat-tool-planner` để hoá thành `EditorCommand`.
 * Một danh mục, hai lối vào. Không có đường tắt nào ghi thẳng vào project.
 *
 * Vì sao HTTP chứ không phải stdio: app này là một cửa sổ GUI đang chạy sẵn.
 * stdio buộc client phải TỰ KHỞI ĐỘNG tiến trình server, tức là mở thêm một
 * instance thứ hai của trình dựng phim — vô nghĩa. HTTP cho phép nối vào đúng
 * cửa sổ người dùng đang làm việc.
 */

/** Cổng mặc định; kẹt thì dò lên vài cổng kế tiếp. */
const DEFAULT_PORT = 5199
const PORT_ATTEMPTS = 10

/** Đặt trùng đường dẫn của OpenChatCut để cấu hình client quen thuộc. */
const MCP_PATH = '/api/external-mcp/mcp'

let httpServer: Server | null = null
let status: McpServerStatus = { running: false }

export function mcpStatus(): McpServerStatus {
  return status
}

/** Đọc token từ header. Chấp nhận cả hai kiểu để dễ cấu hình client. */
function tokenFrom(request: IncomingMessage): string {
  const bearer = request.headers.authorization
  if (typeof bearer === 'string' && bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim()
  }
  const header = request.headers['x-avs-token']
  return typeof header === 'string' ? header.trim() : ''
}

/**
 * Gửi lời gọi công cụ xuống renderer để kiểm tra và áp dụng.
 *
 * Trả về mô tả từng bước bằng tiếng Việt, kèm những bước bị từ chối và lý do —
 * agent cần đọc được vì sao nó bị chặn thì mới sửa được yêu cầu.
 */
async function applyTool(name: ChatToolName, args: unknown): Promise<string> {
  const result = await requestFromRenderer<McpApplyResult>('apply-tools', {
    calls: [{ name, arguments: args }]
  })

  const lines: string[] = []
  if (result.steps.length > 0) lines.push(`Đã áp dụng: ${result.steps.join('; ')}`)
  for (const failure of result.failures) {
    lines.push(`Bị từ chối (${failure.tool}): ${failure.reason}`)
  }
  lines.push(`revision=${result.revision}`)

  return lines.join('\n')
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'ai-video-studio', version: '1.0.0' })

  // ── Công cụ ĐỌC ──────────────────────────────────────────────
  // Agent phải xem được dự án trước khi sửa; không có nhóm này thì nó dựng mù.

  server.registerTool(
    'get_project_overview',
    {
      description:
        'Read the current project: tracks, clips with start/end times, media, transcripts, translations, subtitle tracks, selection and playhead.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: await requestFromRenderer<string>('project-overview', {}) }]
    })
  )

  server.registerTool(
    'get_transcript',
    {
      description:
        'Read a transcript in full: every segment with its id, start and end time in seconds, and the spoken text. Use the segment ids with build_cut_from_transcript to assemble a cut.',
      inputSchema: { transcriptId: z.string().optional() }
    },
    async ({ transcriptId }) => ({
      content: [
        { type: 'text', text: await requestFromRenderer<string>('transcript', { transcriptId }) }
      ]
    })
  )

  server.registerTool(
    'list_media',
    {
      description:
        'List every asset in the media pool with its id, kind, duration, whether it has audio, and the file paths of its thumbnail and filmstrip so they can be viewed directly.',
      inputSchema: {}
    },
    async () => ({
      content: [{ type: 'text', text: await requestFromRenderer<string>('media', {}) }]
    })
  )

  // Công cụ GHI nhưng KHÔNG đi qua danh mục lệnh: nhập media phải probe file,
  // băm nội dung, dựng thumbnail — toàn việc bất đồng bộ, mà đường dựng lệnh của
  // AI Chat là một hàm THUẦN và ĐỒNG BỘ. Nên nó đi lối của các công cụ đọc, và
  // renderer dùng lại đúng hàm mà nút "Nhập media" đang dùng.
  server.registerTool(
    'import_media',
    {
      description:
        'Import files from disk into the media pool so they can be placed on the timeline. Paths must be ABSOLUTE. Returns the id of each imported asset — pass those to insert_clip. Files already in the project are reported as duplicates with the id of the existing asset instead of being imported twice. This only fills the media pool; it does not put anything on the timeline.',
      inputSchema: { filePaths: z.array(z.string()).min(1).max(50) }
    },
    async ({ filePaths }) => ({
      content: [
        { type: 'text', text: await requestFromRenderer<string>('import-media', { filePaths }) }
      ]
    })
  )

  server.registerTool(
    'list_shots',
    {
      description:
        'Detect and list the camera shots in a video, each with its time range and the file path of a still frame taken from its middle. Read those images to choose shots by what they look like. This is the only way to edit footage that has no speech.',
      inputSchema: { assetId: z.string().optional() }
    },
    async ({ assetId }) => ({
      content: [{ type: 'text', text: await requestFromRenderer<string>('shots', { assetId }) }]
    })
  )

  server.registerTool(
    'list_fonts',
    {
      description:
        'List the fonts installed on this machine, with the PostScript name of each face. Only these render correctly: a font that is not installed silently falls back to the default, in the preview and in the exported file alike. Use a name from here with set_text_font.',
      inputSchema: { family: z.string().optional() }
    },
    async ({ family }) => ({
      content: [{ type: 'text', text: await requestFromRenderer<string>('fonts', { family }) }]
    })
  )

  // ── Công cụ GHI ──────────────────────────────────────────────
  // Sinh từ chính danh mục của AI Chat, nên hai lối vào không thể lệch nhau.

  for (const name of Object.keys(chatToolSchemas) as ChatToolName[]) {
    // Nới kiểu schema về dạng chung: lặp qua nhiều schema khác nhau khiến SDK suy
    // ra một union kiểu và không handler nào khớp được. An toàn vì tham số còn
    // được `chat-tool-planner` kiểm lại bằng ĐÚNG schema này trước khi thành lệnh.
    const schema: z.ZodObject<z.ZodRawShape> = chatToolSchemas[name]

    server.registerTool(
      name,
      { description: chatToolDescriptions[name], inputSchema: schema.shape },
      async (args) => ({ content: [{ type: 'text', text: await applyTool(name, args) }] })
    )
  }

  return server
}

async function listenOnFreePort(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<{ server: Server; port: number } | null> {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const port = DEFAULT_PORT + attempt
    const server = createServer(handler)

    const listening = await new Promise<boolean>((resolve) => {
      // Cổng bị chiếm là chuyện thường (một instance khác, hoặc chính OpenChatCut);
      // dò tiếp thay vì làm sập app.
      server.once('error', () => resolve(false))
      server.listen(port, '127.0.0.1', () => resolve(true))
    })

    if (listening) return { server, port }
    server.close()
  }
  return null
}

export async function startMcpServer(): Promise<McpServerStatus> {
  if (httpServer) return status

  const token = randomBytes(24).toString('hex')
  await loadMcpConfig()

  // Không giữ phiên: mỗi yêu cầu dựng server + transport RIÊNG. Một `McpServer`
  // chỉ nối được với đúng một transport, nên dùng lại một instance cho nhiều
  // request sẽ hỏng ngay ở client thứ hai. Dựng lại rẻ — chỉ là đăng ký công cụ.
  // Trạng thái thật nằm ở project, không nằm trong phiên MCP.
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    void (async () => {
      if (!request.url?.startsWith(MCP_PATH)) {
        response.writeHead(404).end('Not found')
        return
      }
      // Kiểm ở TỪNG yêu cầu chứ không chốt lúc khởi động: người dùng bật tắt
      // được ngay, không phải mở lại app.
      if (mcpConfig().requireToken && tokenFrom(request) !== token) {
        // Cổng cục bộ vẫn phải có khoá: mọi tiến trình trên máy đều gọi được nó.
        response.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized')
        return
      }

      try {
        const mcp = buildMcpServer()
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        response.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(request, response)
      } catch (error) {
        if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
        response.end(error instanceof Error ? error.message : String(error))
      }
    })()
  }

  const listener = await listenOnFreePort(handler)
  if (!listener) {
    status = {
      running: false,
      error: `Không mở được cổng ${DEFAULT_PORT}–${DEFAULT_PORT + PORT_ATTEMPTS - 1}`
    }
    return status
  }

  httpServer = listener.server
  status = {
    running: true,
    url: `http://127.0.0.1:${listener.port}${MCP_PATH}`,
    token,
    requireToken: mcpConfig().requireToken
  }
  return status
}

/**
 * Bật tắt việc bắt buộc token.
 *
 * Không dựng lại máy chủ: token vẫn sinh ra và vẫn nằm trong trạng thái, chỉ là
 * chốt kiểm bỏ qua nó. Nhờ vậy bật lại là có hiệu lực ngay với đúng khoá cũ,
 * client đang nối không phải cấu hình lại.
 */
export async function setMcpTokenRequired(requireToken: boolean): Promise<McpServerStatus> {
  await setMcpRequireToken(requireToken)
  if (status.running) status = { ...status, requireToken }
  return status
}

export async function stopMcpServer(): Promise<void> {
  if (!httpServer) return
  const server = httpServer
  httpServer = null
  status = { running: false }
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

/** Cửa sổ đóng hết thì công cụ ghi sẽ hỏng — dùng để báo trạng thái cho người dùng. */
export function mcpCanEdit(): boolean {
  return isRendererAvailable()
}
