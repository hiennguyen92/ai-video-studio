import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { FrameRate } from '../../shared/domain/time-units'
import { secondsToMicros } from '../../shared/domain/time-units'
import type { MediaKind, MediaProbe } from '../../shared/domain/media-asset-types'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

const execFileAsync = promisify(execFile)

/** Đọc metadata media bằng ffprobe. */

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  duration?: string
  channels?: number
  sample_rate?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string; format_name?: string }
}

/** "30000/1001" -> { num: 30000, den: 1001 }. Trả null với "0/0" của stream ảnh. */
function parseRationalFrameRate(value?: string): FrameRate | null {
  if (!value) return null
  const [numText, denText] = value.split('/')
  const num = Number(numText)
  const den = Number(denText ?? 1)
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0) return null
  return { num, den }
}

/**
 * Góc xoay từ display matrix.
 * ffprobe trả góc âm theo chiều kim đồng hồ; chuẩn hoá về 0/90/180/270.
 */
function parseRotation(stream: FfprobeStream): number {
  const fromSideData = stream.side_data_list?.find(
    (entry) => entry.side_data_type === 'Display Matrix'
  )?.rotation
  const fromTag = stream.tags?.rotate ? Number(stream.tags.rotate) : undefined
  const raw = fromSideData ?? fromTag ?? 0
  if (!Number.isFinite(raw)) return 0
  return ((Math.round(-raw) % 360) + 360) % 360
}

export function mediaKindFromProbe(probe: MediaProbe, formatName?: string): MediaKind {
  if (probe.hasVideo) {
    // Ảnh tĩnh cũng hiện ra như video stream một frame — phân biệt bằng tên format.
    const imageFormats = ['image2', 'png_pipe', 'jpeg_pipe', 'webp_pipe', 'gif']
    const isImage =
      !probe.hasAudio &&
      (probe.durationUs === 0 || imageFormats.some((name) => formatName?.includes(name)))
    return isImage ? 'image' : 'video'
  }
  return 'audio'
}

export interface ProbeResult {
  probe: MediaProbe
  kind: MediaKind
}

export async function probeMediaFile(filePath: string): Promise<ProbeResult> {
  const { ffprobePath } = resolveFfmpegBinaries()

  const { stdout } = await execFileAsync(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { maxBuffer: 8 * 1024 * 1024 }
  )

  const parsed = JSON.parse(stdout) as FfprobeOutput
  const streams = parsed.streams ?? []
  const videoStream = streams.find((stream) => stream.codec_type === 'video')
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')

  const durationSeconds = Number(
    parsed.format?.duration ?? videoStream?.duration ?? audioStream?.duration ?? 0
  )

  // avg_frame_rate phản ánh nhịp thực tế (kể cả VFR); r_frame_rate là nhịp danh nghĩa.
  const frameRate =
    parseRationalFrameRate(videoStream?.avg_frame_rate) ??
    parseRationalFrameRate(videoStream?.r_frame_rate) ??
    undefined

  const rotation = videoStream ? parseRotation(videoStream) : 0
  const rotated = rotation === 90 || rotation === 270

  const probe: MediaProbe = {
    durationUs: Number.isFinite(durationSeconds) ? secondsToMicros(durationSeconds) : 0,
    width: rotated ? videoStream?.height : videoStream?.width,
    height: rotated ? videoStream?.width : videoStream?.height,
    frameRate,
    rotation,
    hasVideo: Boolean(videoStream),
    hasAudio: Boolean(audioStream),
    audioChannels: audioStream?.channels,
    audioSampleRate: audioStream?.sample_rate ? Number(audioStream.sample_rate) : undefined,
    videoCodec: videoStream?.codec_name,
    audioCodec: audioStream?.codec_name
  }

  return { probe, kind: mediaKindFromProbe(probe, parsed.format?.format_name) }
}
