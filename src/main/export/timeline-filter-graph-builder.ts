import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { projectDurationUs } from '../../shared/domain/project-document-types'
import type { Clip, Track } from '../../shared/domain/timeline-track-types'
import { clipEndUs, DEFAULT_CLIP_TRANSFORM } from '../../shared/domain/timeline-track-types'
import { microsToSeconds } from '../../shared/domain/time-units'

/**
 * Dựng câu lệnh ffmpeg từ timeline.
 *
 * Là HÀM THUẦN, không chạy tiến trình nào, để có thể kiểm thử chính chuỗi tham số
 * sinh ra. Lỗi ở lớp này (sai offset, sai thứ tự lớp, quên chuẩn hoá âm lượng)
 * biểu hiện ra thành file xuất sai và rất khó truy nếu chỉ nhìn kết quả cuối.
 *
 * Chiến lược: MỘT filter_complex duy nhất.
 * - Nền là một nguồn `color` dài bằng cả timeline, nên khoảng trống thành đen
 *   thay vì làm ngắn video.
 * - Mỗi clip video được cắt, dịch PTS về đúng vị trí timeline, rồi `overlay` lên
 *   nền với `enable=between(...)` để chỉ hiện đúng khoảng thời gian của nó.
 * - Audio trộn bằng `amix` với `normalize=0`; thiếu tham số này ffmpeg sẽ CHIA
 *   âm lượng cho số đầu vào, khiến thêm một track nhạc lại làm nhỏ cả lời thoại.
 */

export interface ExportSettings {
  outputPath: string
  width: number
  height: number
  frameRate: { num: number; den: number }
  sampleRate: number
  /** CRF cho libx264. Bỏ qua khi dùng bộ mã hoá phần cứng. */
  crf: number
  /** Bitrate cho bộ mã hoá phần cứng, ví dụ "8M". */
  hardwareBitrate: string
  useHardwareEncoder: boolean
  /** File .ass để nung phụ đề vào hình. */
  burnSubtitlesAssPath?: string
}

export interface BuiltCommand {
  args: string[]
  /** Tổng thời lượng, dùng để quy đổi tiến trình ra phần trăm. */
  totalDurationUs: number
  inputCount: number
}

function seconds(us: number): string {
  return microsToSeconds(us).toFixed(6)
}

/**
 * Escape đường dẫn cho filter `subtitles`.
 * Dấu hai chấm phân tách tham số filter, dấu gạch chéo ngược là ký tự thoát —
 * đường dẫn macOS/Windows chứa cả hai nên phải xử lý trước khi ghép chuỗi.
 */
export function escapeFilterPath(path: string): string {
  return path.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

interface PlacedClip {
  clip: Clip
  track: Track
  inputIndex: number
  assetPath: string
}

function collectClips(
  document: ProjectDocument,
  kind: 'video' | 'audio'
): Array<Omit<PlacedClip, 'inputIndex'>> {
  const result: Array<Omit<PlacedClip, 'inputIndex'>> = []

  for (const track of document.tracks) {
    if (track.kind !== kind) continue
    if (kind === 'video' && track.hidden) continue
    if (kind === 'audio' && track.muted) continue

    for (const clip of track.clips) {
      const asset = document.assets.find((item) => item.id === clip.assetId)
      // Media thiếu file thì bỏ qua: dừng cả bản export vì một asset mất tích sẽ
      // khó chịu hơn nhiều so với việc xuất ra phần còn lại.
      if (!asset || asset.missing) continue
      result.push({ clip, track, assetPath: asset.source.path })
    }
  }

  return result
}

/** Solo trên bất kỳ track audio nào làm im mọi track audio khác. */
function audioTrackGain(track: Track, anySolo: boolean): number {
  if (anySolo && !track.solo) return 0
  return track.volume
}

export function buildExportCommand(
  document: ProjectDocument,
  settings: ExportSettings
): BuiltCommand {
  const totalDurationUs = projectDurationUs(document)
  const totalSeconds = seconds(totalDurationUs)
  const fps = `${settings.frameRate.num}/${settings.frameRate.den}`

  const videoClips = collectClips(document, 'video')
  const audioClips = collectClips(document, 'audio')
  const anySolo = document.tracks.some((track) => track.kind === 'audio' && track.solo)

  const inputArgs: string[] = []
  const filters: string[] = []

  // Cùng một file có thể xuất hiện ở nhiều clip; mỗi clip nhận một input riêng để
  // mỗi nhánh có bộ giải mã và con trỏ thời gian độc lập.
  const placedVideo: PlacedClip[] = videoClips.map((entry, index) => {
    inputArgs.push('-i', entry.assetPath)
    return { ...entry, inputIndex: index }
  })
  const placedAudio: PlacedClip[] = audioClips.map((entry, index) => {
    inputArgs.push('-i', entry.assetPath)
    return { ...entry, inputIndex: placedVideo.length + index }
  })

  /* ── Nhánh hình ─────────────────────────────────────────────── */

  filters.push(
    `color=c=${document.settings.backgroundColor}:s=${settings.width}x${settings.height}:r=${fps}:d=${totalSeconds}[base0]`
  )

  let videoLabel = 'base0'
  placedVideo.forEach((placed, order) => {
    const { clip } = placed
    const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
    const sourceOut = clip.sourceInUs + Math.round(clip.durationUs * clip.speed)
    const startSeconds = seconds(clip.startUs)
    const endSeconds = seconds(clipEndUs(clip))

    const steps = [
      `trim=start=${seconds(clip.sourceInUs)}:end=${seconds(sourceOut)}`,
      // Đưa clip về mốc 0 rồi đẩy tới đúng vị trí trên timeline.
      `setpts=(PTS-STARTPTS)/${clip.speed}+${startSeconds}/TB`,
      // Vừa khung theo tỉ lệ gốc rồi chèn viền đen — giống `object-fit: contain`
      // của bản xem trước, nên hình xuất ra khớp hình đã xem.
      `scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease`,
      `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=${document.settings.backgroundColor}`
    ]

    if (transform.scale !== 1) {
      steps.push(`scale=iw*${transform.scale}:ih*${transform.scale}`)
    }
    if (transform.rotationDeg !== 0) {
      steps.push(`rotate=${transform.rotationDeg}*PI/180:c=none`)
    }
    // Kênh alpha là bắt buộc trước khi chỉnh độ mờ, nếu không overlay sẽ đè đặc.
    steps.push('format=yuva420p')
    if (transform.opacity < 1) {
      steps.push(`colorchannelmixer=aa=${transform.opacity}`)
    }
    if (clip.fadeInUs > 0) {
      steps.push(`fade=t=in:st=${startSeconds}:d=${seconds(clip.fadeInUs)}:alpha=1`)
    }
    if (clip.fadeOutUs > 0) {
      const fadeStart = clipEndUs(clip) - clip.fadeOutUs
      steps.push(`fade=t=out:st=${seconds(fadeStart)}:d=${seconds(clip.fadeOutUs)}:alpha=1`)
    }

    const clipLabel = `v${order}`
    filters.push(`[${placed.inputIndex}:v]${steps.join(',')}[${clipLabel}]`)

    const nextLabel = `base${order + 1}`
    const x = Math.round((transform.x * settings.width) / 2)
    const y = Math.round((transform.y * settings.height) / 2)
    filters.push(
      `[${videoLabel}][${clipLabel}]overlay=x=${x}:y=${y}:` +
        `enable='between(t,${startSeconds},${endSeconds})':eof_action=pass[${nextLabel}]`
    )
    videoLabel = nextLabel
  })

  // Nung phụ đề SAU khi đã ghép hết lớp hình, để chữ luôn nằm trên cùng.
  if (settings.burnSubtitlesAssPath) {
    filters.push(
      `[${videoLabel}]subtitles='${escapeFilterPath(settings.burnSubtitlesAssPath)}'[vburn]`
    )
    videoLabel = 'vburn'
  }

  filters.push(`[${videoLabel}]format=yuv420p[vout]`)

  /* ── Nhánh tiếng ────────────────────────────────────────────── */

  const audioLabels: string[] = []
  placedAudio.forEach((placed, order) => {
    const { clip, track } = placed
    const gain = clip.volume * audioTrackGain(track, anySolo)
    if (gain <= 0) return

    const sourceOut = clip.sourceInUs + Math.round(clip.durationUs * clip.speed)
    const steps = [
      `atrim=start=${seconds(clip.sourceInUs)}:end=${seconds(sourceOut)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${settings.sampleRate}`
    ]

    if (clip.speed !== 1) {
      // atempo chỉ nhận 0.5–2.0 mỗi tầng, nên tốc độ ngoài khoảng đó phải ghép nhiều tầng.
      for (const factor of splitTempoFactors(clip.speed)) {
        steps.push(`atempo=${factor}`)
      }
    }
    if (clip.fadeInUs > 0) {
      steps.push(`afade=t=in:st=0:d=${seconds(clip.fadeInUs)}`)
    }
    if (clip.fadeOutUs > 0) {
      const fadeStart = clip.durationUs - clip.fadeOutUs
      steps.push(`afade=t=out:st=${seconds(fadeStart)}:d=${seconds(clip.fadeOutUs)}`)
    }
    if (gain !== 1) {
      steps.push(`volume=${gain}`)
    }
    // adelay tính bằng mili giây; `all=1` áp cho mọi kênh, khỏi phải liệt kê từng kênh.
    if (clip.startUs > 0) {
      steps.push(`adelay=${Math.round(clip.startUs / 1000)}:all=1`)
    }

    const label = `a${order}`
    filters.push(`[${placed.inputIndex}:a]${steps.join(',')}[${label}]`)
    audioLabels.push(label)
  })

  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join('')}` +
        `amix=inputs=${audioLabels.length}:duration=longest:normalize=0[amixed]`
    )
    // Chặn cắt đỉnh khi nhiều track cộng lại vượt 0 dBFS.
    filters.push(`[amixed]alimiter=limit=0.98:level=disabled[aout]`)
  } else {
    // Vẫn phải có tiếng: file MP4 không có audio stream gây rắc rối cho nhiều trình phát.
    inputArgs.push(
      '-f',
      'lavfi',
      '-i',
      `anullsrc=channel_layout=stereo:sample_rate=${settings.sampleRate}`
    )
    filters.push(
      `[${placedVideo.length + placedAudio.length}:a]atrim=duration=${totalSeconds}[aout]`
    )
  }

  /* ── Tham số mã hoá ─────────────────────────────────────────── */

  const encoderArgs = settings.useHardwareEncoder
    ? // videotoolbox KHÔNG hỗ trợ CRF, chỉ nhận bitrate.
      ['-c:v', 'h264_videotoolbox', '-b:v', settings.hardwareBitrate]
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(settings.crf)]

  const args = [
    '-hide_banner',
    '-y',
    ...inputArgs,
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[vout]',
    '-map',
    '[aout]',
    ...encoderArgs,
    '-pix_fmt',
    'yuv420p',
    // fps_mode=cfr ép nhịp hình cố định; thiếu nó ffmpeg có thể xuất VFR và
    // thời lượng lệch so với timeline.
    '-fps_mode',
    'cfr',
    '-r',
    fps,
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    String(settings.sampleRate),
    '-t',
    totalSeconds,
    // faststart đưa moov atom lên đầu file để phát được ngay khi chưa tải xong.
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    settings.outputPath
  ]

  return { args, totalDurationUs, inputCount: placedVideo.length + placedAudio.length }
}

/**
 * atempo chỉ chấp nhận hệ số 0.5–2.0, nên tốc độ nằm ngoài khoảng đó phải tách
 * thành tích của nhiều tầng, ví dụ 4.0 = 2.0 × 2.0.
 */
export function splitTempoFactors(speed: number): number[] {
  const factors: number[] = []
  let remaining = speed

  while (remaining > 2) {
    factors.push(2)
    remaining /= 2
  }
  while (remaining < 0.5) {
    factors.push(0.5)
    remaining /= 0.5
  }
  factors.push(Number(remaining.toFixed(6)))
  return factors
}
