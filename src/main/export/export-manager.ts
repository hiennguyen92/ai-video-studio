import { fontsDirectory } from '../storage/font-store'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, parse } from 'node:path'
import type { WebContents } from 'electron'
import type {
  ExportCapabilities,
  ExportProgressEvent,
  ExportRequest
} from '../../shared/ipc/ipc-contract'
import { IPC_EVENT } from '../../shared/ipc/ipc-contract'
import { createId } from '../../shared/domain/project-document-factory'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'
import { startExport, type ExportHandle } from './export-job-runner'
import { startRemotionExport } from './remotion-export-runner'
import { writeAssFile, writeSrtFile } from './subtitle-file-writers'
import { normalizeLoudnessInPlace } from './loudness-normalization'

/**
 * Quản lý các lần xuất đang chạy.
 *
 * Mỗi job có id riêng nên huỷ được đúng job, và tiến trình được ĐẨY về renderer
 * thay vì bắt renderer hỏi liên tục.
 */

const execFileAsync = promisify(execFile)

const HARDWARE_ENCODER = process.platform === 'darwin' ? 'h264_videotoolbox' : 'h264_nvenc'

let cachedCapabilities: ExportCapabilities | null = null

/** Hỏi thẳng ffmpeg xem có bộ mã hoá phần cứng không, thay vì đoán theo hệ điều hành. */
export async function detectExportCapabilities(): Promise<ExportCapabilities> {
  if (cachedCapabilities) return cachedCapabilities

  try {
    const { ffmpegPath } = resolveFfmpegBinaries()
    const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-encoders'], {
      maxBuffer: 8 * 1024 * 1024
    })
    const available = stdout.includes(HARDWARE_ENCODER)
    cachedCapabilities = {
      hardwareEncoderAvailable: available,
      hardwareEncoderName: available ? HARDWARE_ENCODER : undefined
    }
  } catch {
    cachedCapabilities = { hardwareEncoderAvailable: false }
  }

  return cachedCapabilities
}

const activeJobs = new Map<string, ExportHandle>()

/**
 * Sự kiện mới nhất của từng job, để ai không nghe IPC — agent MCP — vẫn HỎI được
 * tiến độ. Giữ cả job đã xong: agent cần đọc được kết quả sau khi job kết thúc.
 */
const latestEvents = new Map<string, ExportProgressEvent>()

export function exportJobStatus(jobId: string): ExportProgressEvent | undefined {
  return latestEvents.get(jobId)
}

function emit(sender: WebContents | null, event: ExportProgressEvent): void {
  latestEvents.set(event.jobId, event)
  if (sender && !sender.isDestroyed()) sender.send(IPC_EVENT.exportProgress, event)
}

/**
 * `sender` null nghĩa là job của agent MCP: không đẩy sự kiện về cửa sổ, vì hộp
 * thoại Xuất đang mở sẽ tưởng đó là job của nó và tự reset.
 */
export async function runExport(
  sender: WebContents | null,
  request: ExportRequest
): Promise<{ jobId: string }> {
  const jobId = createId('export')
  const { document } = request

  // File phụ đề được ghi TRƯỚC khi chạy ffmpeg vì filter graph cần đường dẫn của nó.
  let assPath: string | undefined
  if (request.burnSubtitleTrackId) {
    const track = document.subtitleTracks.find((item) => item.id === request.burnSubtitleTrackId)
    if (track) {
      assPath = join(dirname(request.outputPath), `${parse(request.outputPath).name}.ass`)
      await writeAssFile(track, request.width, request.height, assPath)
    }
  }

  let srtPath: string | undefined
  if (request.exportSrtTrackId) {
    const track = document.subtitleTracks.find((item) => item.id === request.exportSrtTrackId)
    if (track) {
      srtPath = join(dirname(request.outputPath), `${parse(request.outputPath).name}.srt`)
      await writeSrtFile(track, srtPath)
    }
  }

  const handle =
    request.engine === 'remotion'
      ? startRemotionExport(
          document,
          {
            outputPath: request.outputPath,
            width: request.width,
            height: request.height,
            frameRate: request.frameRate,
            useHardwareEncoder: request.useHardwareEncoder
          },
          // Remotion báo tỉ lệ chứ không báo mốc thời gian như ffmpeg.
          (progress) =>
            emit(sender, { jobId, status: 'running', ratio: progress.ratio, outTimeUs: 0 })
        )
      : startExport(
          document,
          {
            outputPath: request.outputPath,
            width: request.width,
            height: request.height,
            frameRate: request.frameRate,
            sampleRate: document.settings.sampleRate,
            crf: 21,
            hardwareBitrate: '10M',
            useHardwareEncoder: request.useHardwareEncoder,
            burnSubtitlesAssPath: assPath,
            burnSubtitlesFontsDir: fontsDirectory()
          },
          (progress) => {
            emit(sender, {
              jobId,
              status: 'running',
              ratio: progress.ratio,
              outTimeUs: progress.outTimeUs,
              speed: progress.speed
            })
          }
        )

  // Huỷ phải dừng được cả lượt chuẩn hoá độ to chạy SAU khi dựng xong.
  const loudnessAbort = new AbortController()
  activeJobs.set(jobId, {
    ...handle,
    cancel: () => {
      handle.cancel()
      loudnessAbort.abort()
    }
  })
  emit(sender, { jobId, status: 'running', outTimeUs: 0 })

  void handle.done
    .then(async (result) => {
      if (result.status === 'succeeded' && request.loudnessLufs != null) {
        emit(sender, { jobId, status: 'running', phase: 'loudness', ratio: 1, outTimeUs: 0 })
        try {
          await normalizeLoudnessInPlace(
            result.outputPath,
            request.loudnessLufs,
            document.settings.sampleRate,
            loudnessAbort.signal
          )
        } catch (error) {
          if (!loudnessAbort.signal.aborted) throw error
          // Huỷ giữa lượt chuẩn hoá: file đã dựng vẫn nguyên, nhưng người dùng đã
          // bấm huỷ — báo đúng là đã huỷ.
          emit(sender, { jobId, status: 'cancelled', outTimeUs: 0 })
          return
        }
      }
      emit(sender, {
        jobId,
        status: result.status,
        outTimeUs: 0,
        outputPath: result.status === 'succeeded' ? result.outputPath : undefined,
        srtPath: result.status === 'succeeded' ? srtPath : undefined
      })
    })
    .catch((error: unknown) => {
      emit(sender, {
        jobId,
        status: 'failed',
        outTimeUs: 0,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    .finally(() => {
      activeJobs.delete(jobId)
    })

  return { jobId }
}

export function cancelExport(jobId: string): void {
  activeJobs.get(jobId)?.cancel()
}

/** Dừng mọi job còn chạy khi ứng dụng thoát, tránh để lại tiến trình ffmpeg mồ côi. */
export function cancelAllExports(): void {
  for (const handle of activeJobs.values()) handle.cancel()
  activeJobs.clear()
}
