import { access, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { requiresRemotionRenderer } from '../../shared/domain/remotion-render-plan'
import { FRAME_RATE_PRESETS } from '../../shared/domain/time-units'
import {
  cancelExport,
  detectExportCapabilities,
  exportJobStatus,
  runExport
} from '../export/export-manager'
import { defaultExportDir } from '../storage/workspace-paths'
import { requestFromRenderer } from './mcp-renderer-bridge'

/**
 * Xuất video qua MCP: bắt đầu, hỏi tiến độ, huỷ.
 *
 * Chia ba công cụ vì một lần xuất mất nhiều phút, dài hơn hạn chờ của một lời gọi
 * MCP. `start_export` trả jobId ngay; agent hỏi lại bằng `get_export_status`.
 *
 * Tuỳ chọn khớp hộp thoại Xuất, và bộ dựng được chọn THEO NỘI DUNG như ở đó: dự
 * án có chữ overlay hay chuyển cảnh thì bắt buộc Remotion, vì ffmpeg xuất ra file
 * thiếu hiệu ứng mà không báo gì.
 */

const SCALE_FACTORS = { full: 1, half: 0.5, quarter: 0.25 } as const

/** Encoder H.264 với yuv420p không nhận cạnh lẻ. */
function toEvenSize(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Đường dẫn chưa bị chiếm trong thư mục Videos, theo tên dự án. */
async function defaultOutputPath(projectName: string): Promise<string> {
  const safeName = projectName.replace(/[/\\:*?"<>|]/g, '-').trim() || 'video'
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` (${attempt})`
    const candidate = join(defaultExportDir(), `${safeName}${suffix}.mp4`)
    if (!(await exists(candidate))) return candidate
  }
  throw new Error('Không tìm được tên file trống trong thư mục Videos')
}

/** Kiểm đường dẫn agent đưa: tuyệt đối, đuôi .mp4, thư mục có thật, không ghi đè ngầm. */
async function checkedOutputPath(path: string, overwrite: boolean): Promise<string> {
  if (!isAbsolute(path)) throw new Error('outputPath phải là đường dẫn tuyệt đối')
  if (!path.toLowerCase().endsWith('.mp4')) throw new Error('outputPath phải có đuôi .mp4')
  const folder = await stat(dirname(path)).catch(() => null)
  if (!folder?.isDirectory()) throw new Error(`Thư mục "${dirname(path)}" không tồn tại`)
  // Hộp thoại lưu của hệ điều hành hỏi trước khi ghi đè; agent không có hộp thoại
  // đó nên phải nói rõ ý muốn, không thì một bản xuất cũ mất mà không ai hay.
  if (!overwrite && (await exists(path))) {
    throw new Error(`File "${basename(path)}" đã có. Đặt overwrite:true hoặc chọn tên khác`)
  }
  return path
}

function text(value: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: value }] }
}

export function registerMcpExportTools(server: McpServer): void {
  server.registerTool(
    'start_export',
    {
      description:
        'Export the open project to an MP4 file, like the Export dialog. Rendering takes minutes, so this returns a jobId straight away; call get_export_status with it until the status is succeeded, failed or cancelled. The renderer is chosen for you: projects with text overlays or transitions render with Remotion, since the faster ffmpeg path would silently drop them. outputPath must be absolute and end in .mp4; leave it out to save into the Videos folder under the project name. An existing file is only replaced with overwrite:true. scale sets the resolution relative to the project canvas, frameRate defaults to the project frame rate. burnSubtitleTrackId burns that subtitle track into the picture; exportSrt also writes a .srt next to the video (from burnSubtitleTrackId, or the first subtitle track). The export renders the project as it is at this moment; later edits do not change it.',
      inputSchema: {
        outputPath: z.string().min(1).max(1024).optional(),
        overwrite: z.boolean().optional(),
        scale: z.enum(['full', 'half', 'quarter']).optional(),
        frameRate: z.enum(['24', '25', '30', '50', '60']).optional(),
        burnSubtitleTrackId: z.string().min(1).max(120).optional(),
        exportSrt: z.boolean().optional()
      }
    },
    async (input) => {
      try {
        const document = await requestFromRenderer<ProjectDocument>('document-snapshot', {})
        const outputPath = input.outputPath
          ? await checkedOutputPath(input.outputPath, input.overwrite ?? false)
          : await defaultOutputPath(document.name)

        if (
          input.burnSubtitleTrackId &&
          !document.subtitleTracks.some((track) => track.id === input.burnSubtitleTrackId)
        ) {
          throw new Error(`Không tìm thấy track phụ đề "${input.burnSubtitleTrackId}"`)
        }
        const srtTrackId = input.exportSrt
          ? (input.burnSubtitleTrackId ?? document.subtitleTracks[0]?.id)
          : undefined
        if (input.exportSrt && !srtTrackId)
          throw new Error('Dự án chưa có track phụ đề nào để xuất .srt')

        const factor = SCALE_FACTORS[input.scale ?? 'full']
        const width = toEvenSize(document.settings.width * factor)
        const height = toEvenSize(document.settings.height * factor)
        const engine = requiresRemotionRenderer(document) ? 'remotion' : 'ffmpeg'
        const capabilities = await detectExportCapabilities()

        const { jobId } = await runExport(null, {
          document,
          outputPath,
          width,
          height,
          frameRate: input.frameRate
            ? FRAME_RATE_PRESETS[input.frameRate]
            : document.settings.frameRate,
          useHardwareEncoder: capabilities.hardwareEncoderAvailable,
          engine,
          burnSubtitleTrackId: input.burnSubtitleTrackId,
          exportSrtTrackId: srtTrackId
        })

        return text(
          [
            `Đã bắt đầu xuất. jobId=${jobId}`,
            `output=${outputPath}`,
            `${width}x${height} engine=${engine}`,
            'Gọi get_export_status với jobId này để theo dõi.'
          ].join('\n')
        )
      } catch (error) {
        return {
          ...text(`Không xuất được: ${error instanceof Error ? error.message : String(error)}`),
          isError: true
        }
      }
    }
  )

  server.registerTool(
    'get_export_status',
    {
      description:
        'Check an export started with start_export: status running, succeeded, failed or cancelled, progress as a percentage when the renderer reports one, the output file path once it succeeded, and the error when it failed. Poll every few seconds, not in a tight loop.',
      inputSchema: { jobId: z.string().min(1).max(120) }
    },
    async ({ jobId }) => {
      const event = exportJobStatus(jobId)
      if (!event) return { ...text(`Không có job xuất "${jobId}"`), isError: true }

      const lines = [`jobId=${jobId} status=${event.status}`]
      // Chưa có tỉ lệ thì nói là đang chuẩn bị, không bịa phần trăm — cùng quy tắc
      // với thanh tiến trình của hộp thoại Xuất.
      if (event.status === 'running') {
        lines.push(
          event.ratio !== undefined
            ? `progress=${Math.round(event.ratio * 100)}%`
            : 'progress=đang chuẩn bị'
        )
      }
      if (event.outputPath) lines.push(`output=${event.outputPath}`)
      if (event.srtPath) lines.push(`srt=${event.srtPath}`)
      if (event.error) lines.push(`error=${event.error}`)
      return text(lines.join('\n'))
    }
  )

  server.registerTool(
    'cancel_export',
    {
      description:
        'Stop a running export started with start_export. A partly written file may be left at the output path.',
      inputSchema: { jobId: z.string().min(1).max(120) }
    },
    async ({ jobId }) => {
      const event = exportJobStatus(jobId)
      if (!event) return { ...text(`Không có job xuất "${jobId}"`), isError: true }
      if (event.status !== 'running')
        return text(`Job đã kết thúc (status=${event.status}), không cần huỷ`)
      cancelExport(jobId)
      return text(`Đã yêu cầu huỷ jobId=${jobId}. Gọi get_export_status để xác nhận.`)
    }
  )
}
