import { access, stat } from 'node:fs/promises'
import { markerSections, type ExportRange } from '../../shared/domain/export-range'
import { projectDurationUs } from '../../shared/domain/project-document-types'
import { renderStillFrame } from '../export/remotion-still-renderer'
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

/**
 * File đang (hoặc sắp) có job ghi vào → id job, hoặc `pending` khi job chưa kịp nhận id.
 *
 * "Chưa có file thì dùng được" là không đủ: file ra chỉ xuất hiện khi bộ dựng bắt
 * đầu ghi — với Remotion là vài giây sau. Hai lời gọi xuất liền nhau (xuất chương 1
 * rồi chương 2) cùng thấy "chưa có" và cùng ghi vào MỘT file; cả hai báo xong, một
 * chương mất.
 */
const reservedOutputs = new Map<string, string>()

function isReserved(path: string): boolean {
  const owner = reservedOutputs.get(path)
  if (!owner) return false
  if (owner === 'pending' || exportJobStatus(owner)?.status === 'running') return true
  reservedOutputs.delete(path)
  return false
}

/** Giữ chỗ NGAY (đồng bộ) — trước bất kỳ lần chờ nào, để hai lời gọi không cùng chọn một tên. */
function reserve(path: string): void {
  reservedOutputs.set(path, 'pending')
}

function release(path: string): void {
  reservedOutputs.delete(path)
}

/** Đường dẫn chưa bị chiếm trong thư mục Videos, theo tên dự án — đã được giữ chỗ. */
async function defaultOutputPath(projectName: string, extension = '.mp4'): Promise<string> {
  const safeName = projectName.replace(/[/\\:*?"<>|]/g, '-').trim() || 'video'
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = attempt === 0 ? '' : ` (${attempt})`
    const candidate = join(defaultExportDir(), `${safeName}${suffix}${extension}`)
    if (isReserved(candidate)) continue
    reserve(candidate)
    if (!(await exists(candidate))) return candidate
    release(candidate)
  }
  throw new Error('Không tìm được tên file trống trong thư mục Videos')
}

/** Kiểm đường dẫn agent đưa: tuyệt đối, đuôi .mp4, thư mục có thật, không ghi đè ngầm. */
async function checkedOutputPath(
  path: string,
  overwrite: boolean,
  extension = '.mp4'
): Promise<string> {
  if (!isAbsolute(path)) throw new Error('outputPath phải là đường dẫn tuyệt đối')
  if (!path.toLowerCase().endsWith(extension)) {
    throw new Error(`outputPath phải có đuôi ${extension}`)
  }
  const folder = await stat(dirname(path)).catch(() => null)
  if (!folder?.isDirectory()) throw new Error(`Thư mục "${dirname(path)}" không tồn tại`)
  // Hộp thoại lưu của hệ điều hành hỏi trước khi ghi đè; agent không có hộp thoại
  // đó nên phải nói rõ ý muốn, không thì một bản xuất cũ mất mà không ai hay.
  if (isReserved(path)) {
    throw new Error(`Đang có một bản xuất khác ghi vào "${basename(path)}". Chọn tên khác`)
  }
  if (!overwrite && (await exists(path))) {
    throw new Error(`File "${basename(path)}" đã có. Đặt overwrite:true hoặc chọn tên khác`)
  }
  reserve(path)
  return path
}

/** Đoạn xuất agent xin: theo marker, theo giây, hoặc cả video. Ném lỗi nói rõ khi sai. */
function resolveAgentRange(
  document: ProjectDocument,
  input: { fromSeconds?: number; toSeconds?: number; markerId?: string }
): ExportRange | undefined {
  const durationUs = projectDurationUs(document)
  if (input.markerId) {
    const section = markerSections(document.markers, durationUs).find(
      (item) => item.markerId === input.markerId
    )
    if (!section) throw new Error(`Không có marker "${input.markerId}" trong video`)
    return { startUs: section.startUs, endUs: section.endUs }
  }
  if (input.fromSeconds === undefined && input.toSeconds === undefined) return undefined
  const startUs = Math.round((input.fromSeconds ?? 0) * 1_000_000)
  const endUs = Math.min(
    durationUs,
    Math.round((input.toSeconds ?? durationUs / 1_000_000) * 1_000_000)
  )
  if (endUs <= startUs) throw new Error('toSeconds phải sau fromSeconds và nằm trong video')
  return { startUs, endUs }
}

function text(value: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: value }] }
}

export function registerMcpExportTools(server: McpServer): void {
  server.registerTool(
    'start_export',
    {
      description:
        'Export the open project to an MP4 file, like the Export dialog. Rendering takes minutes, so this returns a jobId straight away; call get_export_status with it until the status is succeeded, failed or cancelled. The renderer is chosen for you: projects with text overlays or transitions render with Remotion, since the faster ffmpeg path would silently drop them. outputPath must be absolute and end in .mp4; leave it out to save into the Videos folder under the project name. An existing file is only replaced with overwrite:true. scale sets the resolution relative to the project canvas, frameRate defaults to the project frame rate. burnSubtitleTrackId burns that subtitle track into the picture; exportSrt also writes a .srt next to the video (from burnSubtitleTrackId, or the first subtitle track). The export renders the project as it is at this moment; later edits do not change it. loudnessLufs normalizes the loudness of the finished file (two-pass): -14 suits YouTube, TikTok and Instagram and is the default, -16 podcasts, -23 broadcast; pass null to keep the timeline level. quality: high (send this to platforms, they re-compress), standard (default), compact (drafts). To export only part of the timeline pass fromSeconds/toSeconds, or markerId to export the section from that marker to the next one (the Markers list in the project overview has the ids).',
      inputSchema: {
        outputPath: z.string().min(1).max(1024).optional(),
        overwrite: z.boolean().optional(),
        scale: z.enum(['full', 'half', 'quarter']).optional(),
        frameRate: z.enum(['24', '25', '30', '50', '60']).optional(),
        burnSubtitleTrackId: z.string().min(1).max(120).optional(),
        exportSrt: z.boolean().optional(),
        loudnessLufs: z.number().min(-36).max(-8).nullable().optional(),
        quality: z.enum(['high', 'standard', 'compact']).optional(),
        fromSeconds: z.number().min(0).optional(),
        toSeconds: z.number().min(0).optional(),
        markerId: z.string().min(1).max(120).optional()
      }
    },
    async (input) => {
      let outputPath: string | undefined
      try {
        const document = await requestFromRenderer<ProjectDocument>('document-snapshot', {})
        outputPath = input.outputPath
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

        const rangeUs = resolveAgentRange(document, input)
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
          exportSrtTrackId: srtTrackId,
          // Cùng mặc định với hộp thoại Xuất: agent không nói gì thì file ra vẫn đúng mức nền tảng.
          loudnessLufs: input.loudnessLufs === undefined ? -14 : input.loudnessLufs,
          quality: input.quality,
          rangeUs
        })
        // Giữ chỗ tới khi job xong (hết `running`), không chỉ tới lúc nó bắt đầu.
        reservedOutputs.set(outputPath, jobId)

        return text(
          [
            `Đã bắt đầu xuất. jobId=${jobId}`,
            `output=${outputPath}`,
            `${width}x${height} engine=${engine}`,
            `loudness=${input.loudnessLufs === null ? 'giữ nguyên' : `${input.loudnessLufs ?? -14} LUFS`}`,
            'Gọi get_export_status với jobId này để theo dõi.'
          ].join('\n')
        )
      } catch (error) {
        // Job không bắt đầu được: trả chỗ lại, không thì tên file bị giữ vĩnh viễn.
        if (outputPath && reservedOutputs.get(outputPath) === 'pending') release(outputPath)
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
          event.phase === 'loudness'
            ? 'progress=đang chuẩn hoá âm lượng (hình đã dựng xong)'
            : event.ratio !== undefined
              ? `progress=${Math.round(event.ratio * 100)}%`
              : 'progress=đang chuẩn bị'
        )
      }
      if (event.outputPath) lines.push(`output=${event.outputPath}`)
      if (event.srtPath) lines.push(`srt=${event.srtPath}`)
      if (event.warning) lines.push(`warning=${event.warning}`)
      if (event.error) lines.push(`error=${event.error}`)
      return text(lines.join('\n'))
    }
  )

  server.registerTool(
    'export_frame',
    {
      description:
        'Save one frame of the video as a PNG — a cover image or thumbnail to upload with the video. It is rendered by the same engine as the exported video, so text, effects and the blurred background fill appear exactly as in the video. atSeconds is the moment on the timeline. outputPath must be absolute and end in .png; leave it out to save into the Videos folder. scale sets the size relative to the project canvas. Returns once the file is written.',
      inputSchema: {
        atSeconds: z.number().min(0),
        outputPath: z.string().min(1).max(1024).optional(),
        overwrite: z.boolean().optional(),
        scale: z.enum(['full', 'half', 'quarter']).optional()
      }
    },
    async (input) => {
      let outputPath: string | undefined
      try {
        const document = await requestFromRenderer<ProjectDocument>('document-snapshot', {})
        outputPath = input.outputPath
          ? await checkedOutputPath(input.outputPath, input.overwrite ?? false, '.png')
          : await defaultOutputPath(document.name, '.png')
        const factor = SCALE_FACTORS[input.scale ?? 'full']
        const written = await renderStillFrame(document, {
          atUs: Math.round(input.atSeconds * 1_000_000),
          width: toEvenSize(document.settings.width * factor),
          height: toEvenSize(document.settings.height * factor),
          frameRate: document.settings.frameRate,
          outputPath
        })
        return text(`Đã lưu ảnh: ${written}`)
      } catch (error) {
        return { ...text(error instanceof Error ? error.message : String(error)), isError: true }
      } finally {
        // Ảnh ghi xong (hoặc hỏng) là hết giữ chỗ.
        if (outputPath) release(outputPath)
      }
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
