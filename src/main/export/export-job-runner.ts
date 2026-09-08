import { spawn, type ChildProcess } from 'node:child_process'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { buildExportCommand, type ExportSettings } from './timeline-filter-graph-builder'

/**
 * Chạy một lần xuất video.
 *
 * Tiến trình lấy từ `-progress pipe:1` của ffmpeg — số THẬT do bộ mã hoá báo về,
 * không phải thanh chạy giả (DESCRIPTION §6 "không giả phần trăm").
 *
 * Render đọc từ MỘT BẢN CHỤP document đã đóng băng: người dùng có thể tiếp tục
 * dựng trong lúc xuất mà không làm hỏng kết quả (DESCRIPTION §8).
 */

export interface ExportProgress {
  /** 0..1 khi tính được, undefined khi ffmpeg chưa báo mốc thời gian nào. */
  ratio?: number
  outTimeUs: number
  frame: number
  /** Tốc độ so với thời gian thực, ví dụ 2.4 nghĩa là nhanh gấp 2.4 lần. */
  speed?: number
}

export interface ExportHandle {
  cancel(): void
  done: Promise<{ status: 'succeeded' | 'cancelled'; outputPath: string }>
}

/** Dòng lỗi cuối cùng của ffmpeg thường mới là nguyên nhân thật. */
function extractFfmpegError(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const meaningful = lines.filter((line) =>
    /error|invalid|no such|failed|unable|not found/i.test(line)
  )
  return (meaningful.at(-1) ?? lines.at(-1) ?? 'ffmpeg thất bại không rõ lý do').slice(0, 500)
}

export function startExport(
  documentSnapshot: ProjectDocument,
  settings: ExportSettings,
  onProgress: (progress: ExportProgress) => void
): ExportHandle {
  const { ffmpegPath } = resolveFfmpegBinaries()
  const { args, totalDurationUs } = buildExportCommand(documentSnapshot, settings)

  let child: ChildProcess | null = spawn(ffmpegPath, args)
  let cancelled = false
  let stderr = ''

  const done = new Promise<{ status: 'succeeded' | 'cancelled'; outputPath: string }>(
    (resolve, reject) => {
      if (!child) return

      let carry = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        carry += chunk.toString()
        const lines = carry.split('\n')
        // Dòng cuối có thể chưa trọn vẹn — giữ lại cho chunk sau.
        carry = lines.pop() ?? ''

        const fields: Record<string, string> = {}
        for (const line of lines) {
          const separator = line.indexOf('=')
          if (separator > 0) {
            fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
          }
        }

        if (fields.out_time_us || fields.frame) {
          const outTimeUs = Number(fields.out_time_us ?? 0)
          const speed = fields.speed ? Number(fields.speed.replace('x', '')) : undefined
          onProgress({
            outTimeUs: Number.isFinite(outTimeUs) ? outTimeUs : 0,
            frame: Number(fields.frame ?? 0),
            speed: Number.isFinite(speed as number) ? speed : undefined,
            ratio:
              totalDurationUs > 0 && Number.isFinite(outTimeUs)
                ? Math.max(0, Math.min(1, outTimeUs / totalDurationUs))
                : undefined
          })
        }
      })

      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        // Giữ bộ đệm ở mức vừa phải: một bản render dài có thể sinh rất nhiều log.
        if (stderr.length > 64_000) stderr = stderr.slice(-32_000)
      })

      child.on('error', (error) => reject(error))

      child.on('close', (code, signal) => {
        child = null
        if (cancelled || signal === 'SIGTERM' || signal === 'SIGKILL') {
          resolve({ status: 'cancelled', outputPath: settings.outputPath })
          return
        }
        if (code === 0) {
          resolve({ status: 'succeeded', outputPath: settings.outputPath })
          return
        }
        reject(new Error(extractFfmpegError(stderr)))
      })
    }
  )

  return {
    cancel: () => {
      cancelled = true
      // SIGTERM để ffmpeg đóng file tử tế; nếu treo thì mới cưỡng bức.
      child?.kill('SIGTERM')
      const pending = child
      setTimeout(() => {
        if (pending && !pending.killed) pending.kill('SIGKILL')
      }, 3000)
    },
    done
  }
}
