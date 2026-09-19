import { execFile } from 'node:child_process'
import { access, rename, rm } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { promisify } from 'node:util'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { createId } from '../../shared/domain/project-document-factory'
import {
  VOICE_CLEANUP_STRENGTHS,
  type VoiceCleanupRequest,
  type VoiceCleanupStrength
} from '../../shared/ipc/voice-cleanup-types'
import { ensureProjectDirs } from '../storage/workspace-paths'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { importMediaFile } from './media-import-service'

/**
 * Làm sạch giọng nói: lọc tiếng ù tần thấp rồi giảm nhiễu nền, ghi ra một file
 * MỚI trong thư mục media của dự án. File gốc không bị đụng tới.
 *
 * Ra file thật thay vì gắn bộ lọc vào clip: bản xem trước phát trong trình duyệt,
 * không chạy được bộ lọc của ffmpeg, nên gắn bộ lọc thì nghe trước một đằng, xuất
 * ra một nẻo. Một file âm thanh thật thì preview và cả hai bộ dựng phát y hệt.
 *
 * FLAC chứ không AAC: AAC chèn một đoạn mồi ở đầu file, lệch vài chục mili giây
 * so với hình — đủ để khẩu hình trễ hơn tiếng. FLAC không mất dữ liệu và bắt đầu
 * đúng mẫu đầu tiên.
 */

const execFileAsync = promisify(execFile)

/**
 * Chuỗi lọc.
 *
 * - `highpass=f=80`: cắt ù điện, rung bàn, gió — dưới 80 Hz không có giọng người.
 * - `afftdn` với `tn=1`: giảm nhiễu phổ, TỰ THEO DÕI nền nhiễu thay vì bắt người
 *   dùng chọn một đoạn im làm mẫu. `nf=-40` là mức nền khởi đầu hợp với phòng
 *   thường; bộ theo dõi tự chỉnh từ đó.
 */
export function voiceCleanupFilter(strength: VoiceCleanupStrength): string {
  return `highpass=f=80,afftdn=nr=${VOICE_CLEANUP_STRENGTHS[strength]}:nf=-40:tn=1`
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function cleanVoice(request: VoiceCleanupRequest): Promise<MediaAsset> {
  const { source, strength } = request
  if (!source.probe.hasAudio) throw new Error(`"${source.name}" không có tiếng để làm sạch`)

  const { mediaDir } = await ensureProjectDirs(request.projectId)
  // Tên theo asset gốc + mức: làm lại cùng mức thì dùng luôn file đã có.
  const outputPath = join(mediaDir, `${source.id}-voice-${strength}.flac`)

  if (!(await exists(outputPath))) {
    const tempPath = `${outputPath}.tmp.flac`
    try {
      await execFileAsync(
        resolveFfmpegBinaries().ffmpegPath,
        [
          '-v',
          'error',
          '-y',
          '-i',
          source.source.path,
          '-vn',
          '-af',
          voiceCleanupFilter(strength),
          '-c:a',
          'flac',
          tempPath
        ],
        { maxBuffer: 16 * 1024 * 1024 }
      )
      await rename(tempPath, outputPath)
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
    }
  }

  const imported = await importMediaFile(
    {
      projectId: request.projectId,
      filePath: outputPath,
      generated: {
        task: 'voice-cleanup',
        providerId: 'ffmpeg',
        model: `highpass+afftdn:${strength}`,
        jobId: createId('job'),
        requestFingerprint: `${source.source.contentHash}:${strength}`,
        sourceAssetId: source.id
      }
    },
    request.existing
  )
  if (imported.duplicateOfAssetId) return imported.asset

  return { ...imported.asset, name: `${parse(source.name).name} · giọng sạch (${strength})` }
}
