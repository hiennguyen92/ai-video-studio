import { execFile } from 'node:child_process'
import { access, rename, rm } from 'node:fs/promises'
import { join, parse } from 'node:path'
import { promisify } from 'node:util'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { createId } from '../../shared/domain/project-document-factory'
import { frameRateToNumber, type FrameRate, type Micros } from '../../shared/domain/time-units'
import { ensureProjectDirs } from '../storage/workspace-paths'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { importMediaFile } from './media-import-service'

/**
 * Đóng băng một khung hình: dựng một đoạn video ngắn chỉ gồm đúng khung đó.
 *
 * Ra VIDEO chứ không ra ảnh: ảnh trên lane hình thì bộ dựng ffmpeg không đọc được
 * (nó đọc lane hình theo trục thời gian của video) và dự án bị đẩy sang Remotion.
 * Một đoạn H.264 thì preview và cả hai bộ dựng coi như clip thường.
 *
 * File dài `FREEZE_ASSET_US` dù clip chỉ dùng vài giây: người dùng kéo mép clip để
 * kéo dài đoạn đứng hình, và kéo được là vì nguồn còn dư.
 */

const execFileAsync = promisify(execFile)

/** Độ dài file đóng băng — mức tối đa có thể kéo dài clip ra. */
export const FREEZE_ASSET_US: Micros = 10_000_000

export interface FreezeFrameRequest {
  projectId: string
  source: MediaAsset
  /** Mốc trên trục NGUỒN của file. */
  sourceUs: Micros
  frameRate: FrameRate
  existing: MediaAsset[]
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function createFreezeFrame(request: FreezeFrameRequest): Promise<MediaAsset> {
  const { source, sourceUs } = request
  if (!source.probe.hasVideo) throw new Error(`"${source.name}" không có hình để đóng băng`)

  const { mediaDir } = await ensureProjectDirs(request.projectId)
  const ms = Math.round(sourceUs / 1000)
  const outputPath = join(mediaDir, `${source.id}-freeze-${ms}ms.mp4`)
  const stillPath = join(mediaDir, `${source.id}-freeze-${ms}ms.png`)
  const { ffmpegPath } = resolveFfmpegBinaries()

  if (!(await exists(outputPath))) {
    const tempPath = `${outputPath}.tmp.mp4`
    try {
      // `-ss` trước `-i` vẫn chính xác từng khung khi có giải mã lại (ffmpeg ≥ 2.1),
      // và nhanh hơn hẳn với file dài.
      await execFileAsync(ffmpegPath, [
        '-v',
        'error',
        '-y',
        '-ss',
        String(sourceUs / 1_000_000),
        '-i',
        source.source.path,
        '-frames:v',
        '1',
        stillPath
      ])
      await execFileAsync(ffmpegPath, [
        '-v',
        'error',
        '-y',
        '-loop',
        '1',
        '-framerate',
        String(frameRateToNumber(request.frameRate)),
        '-t',
        String(FREEZE_ASSET_US / 1_000_000),
        '-i',
        stillPath,
        // Cạnh chẵn: h264 với yuv420p không mã hoá được cạnh lẻ.
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-tune',
        'stillimage',
        // Chất lượng cao: một khung đứng yên nén gần như không tốn gì, mà người xem
        // nhìn chằm chằm vào nó vài giây — mờ đi so với khung trước là thấy ngay.
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        tempPath
      ])
      await rename(tempPath, outputPath)
    } catch (error) {
      await rm(tempPath, { force: true })
      throw error
    } finally {
      await rm(stillPath, { force: true })
    }
  }

  const imported = await importMediaFile(
    {
      projectId: request.projectId,
      filePath: outputPath,
      generated: {
        task: 'freeze-frame',
        providerId: 'ffmpeg',
        model: 'still-loop',
        jobId: createId('job'),
        requestFingerprint: `${source.source.contentHash}:${ms}`,
        sourceAssetId: source.id
      }
    },
    request.existing
  )
  if (imported.duplicateOfAssetId) return imported.asset
  const seconds = (sourceUs / 1_000_000).toFixed(2)
  return { ...imported.asset, name: `${parse(source.name).name} · đứng hình ${seconds}s` }
}
