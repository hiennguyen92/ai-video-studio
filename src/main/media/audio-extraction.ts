import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Micros } from '../../shared/domain/time-units'
import { microsToSeconds } from '../../shared/domain/time-units'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'

const execFileAsync = promisify(execFile)

/**
 * Trích audio ra định dạng mà bộ nhận dạng giọng nói cần.
 *
 * whisper.cpp yêu cầu WAV 16 kHz mono 16-bit; đưa định dạng khác vào thì nó từ
 * chối hoặc cho kết quả rác. Đây cũng là định dạng gần như mọi engine STT khác
 * muốn, nên chuyển đổi ở một chỗ dùng chung được cho cả provider đám mây.
 *
 * File tạm luôn nằm trong thư mục cache của project, không phải thư mục nguồn:
 * chỉnh sửa không được đụng tới file gốc của người dùng (DESCRIPTION §7).
 */

/** Tần số lấy mẫu mà whisper.cpp và phần lớn model STT yêu cầu. */
export const TRANSCRIPTION_SAMPLE_RATE = 16_000

export interface ExtractAudioRequest {
  sourcePath: string
  /** Điểm bắt đầu TRONG FILE NGUỒN, không phải trên timeline. */
  sourceInUs: Micros
  /** Số microgiây nguồn cần lấy. */
  durationUs: Micros
  outputPath: string
}

export async function extractAudioForTranscription(request: ExtractAudioRequest): Promise<void> {
  const { ffmpegPath } = resolveFfmpegBinaries()

  if (request.durationUs <= 0) {
    throw new Error('Khoảng thời gian cần phiên âm phải lớn hơn 0.')
  }

  await execFileAsync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-y',
      // -ss ĐẶT SAU -i để cắt chính xác theo mẫu. Đặt trước -i sẽ nhảy theo
      // keyframe, nhanh hơn nhưng lệch tới vài trăm mili giây — đủ để mọi
      // timestamp của transcript trôi khỏi hình.
      '-i',
      request.sourcePath,
      '-ss',
      microsToSeconds(request.sourceInUs).toFixed(6),
      '-t',
      microsToSeconds(request.durationUs).toFixed(6),
      '-vn',
      '-ac',
      '1',
      '-ar',
      String(TRANSCRIPTION_SAMPLE_RATE),
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      request.outputPath
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  )
}

/**
 * Trộn nhiều nguồn audio thành một file để phiên âm.
 *
 * Dùng khi người dùng chọn một khoảng thời gian trên timeline thay vì một clip:
 * lời nói có thể nằm rải trên nhiều clip và nhiều track.
 */
export interface MixSource {
  path: string
  sourceInUs: Micros
  durationUs: Micros
  /** Vị trí trên timeline, tính từ đầu khoảng được chọn. */
  offsetUs: Micros
}

export async function mixAudioForTranscription(
  sources: MixSource[],
  totalDurationUs: Micros,
  outputPath: string
): Promise<void> {
  const { ffmpegPath } = resolveFfmpegBinaries()

  if (sources.length === 0) {
    throw new Error('Không có nguồn audio nào trong khoảng được chọn.')
  }

  const inputs: string[] = []
  const filters: string[] = []
  const labels: string[] = []

  sources.forEach((source, index) => {
    inputs.push('-i', source.path)
    const label = `a${index}`
    filters.push(
      `[${index}:a]` +
        [
          `atrim=start=${microsToSeconds(source.sourceInUs).toFixed(6)}:end=${microsToSeconds(source.sourceInUs + source.durationUs).toFixed(6)}`,
          'asetpts=PTS-STARTPTS',
          `aresample=${TRANSCRIPTION_SAMPLE_RATE}`,
          `adelay=${Math.round(source.offsetUs / 1000)}:all=1`
        ].join(',') +
        `[${label}]`
    )
    labels.push(`[${label}]`)
  })

  // normalize=0 vì cùng lý do như lúc xuất video: amix mặc định chia âm lượng
  // cho số đầu vào, làm lời nói nhỏ đi khi có thêm track nhạc.
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0[aout]`)

  await execFileAsync(
    ffmpegPath,
    [
      '-v',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[aout]',
      '-ac',
      '1',
      '-ar',
      String(TRANSCRIPTION_SAMPLE_RATE),
      '-c:a',
      'pcm_s16le',
      '-t',
      microsToSeconds(totalDurationUs).toFixed(6),
      '-f',
      'wav',
      outputPath
    ],
    { maxBuffer: 8 * 1024 * 1024 }
  )
}
