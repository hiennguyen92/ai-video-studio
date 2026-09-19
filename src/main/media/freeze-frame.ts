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

/** Mốc bắt đầu của luồng hình (giây) — thường 0, nhưng có file bắt đầu lệch. */
async function videoStartSeconds(sourcePath: string): Promise<number> {
  const { stdout } = await execFileAsync(resolveFfmpegBinaries().ffprobePath, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=start_time',
    '-of',
    'csv=p=0',
    sourcePath
  ])
  const value = Number.parseFloat(stdout.trim())
  return Number.isFinite(value) ? value : 0
}

/**
 * Lấy khung ĐANG HIỆN tại `atUs`: khung cuối cùng có mốc ≤ `atUs` — đúng khung
 * mà bản xem trước vẽ.
 *
 * Không dùng `-ss atUs -frames:v 1`: cách đó lấy khung ĐẦU TIÊN có mốc ≥ `atUs`,
 * tức khung kế tiếp khi mốc rơi giữa hai khung, và không lấy được gì khi mốc nằm
 * trong khung cuối (ffmpeg vẫn thoát 0, không ghi file).
 *
 * Ở đây giữ nguyên mốc gốc của file (`-copyts`), lọc khung theo mốc TUYỆT ĐỐI
 * (`select=lte(t, …)`), và `-update 1` ghi đè ảnh mỗi khung — ảnh còn lại là khung
 * cuối cùng không quá mốc. Không giữ mốc gốc thì sau khi tua ffmpeg dời khung đầu
 * về 0, và phép so theo mốc lệch đi tới một khung. Đã kiểm bằng PSNR trên
 * `testsrc2`: 2,02 s → khung 60, 5,99 s → khung cuối 179.
 */
async function extractFrameAtOrBefore(
  ffmpegPath: string,
  sourcePath: string,
  atUs: number,
  outputPath: string
): Promise<void> {
  const target = (await videoStartSeconds(sourcePath)) + atUs / 1_000_000
  // Tua tới trước mốc một giây cho nhanh; dừng giải mã ngay sau mốc.
  const seek = Math.max(0, target - 1)
  await rm(outputPath, { force: true })
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-ss',
    String(seek),
    '-copyts',
    '-i',
    sourcePath,
    '-an',
    // Nửa mili giây dôi ra để khung nằm ĐÚNG tại mốc cũng được tính.
    '-vf',
    `select=lte(t\\,${target + 0.0005})`,
    '-fps_mode',
    'passthrough',
    '-to',
    String(target + 0.1),
    '-update',
    '1',
    outputPath
  ])
  if (!(await exists(outputPath))) {
    throw new Error('Không có khung hình nào tại mốc này — mốc nằm ngoài phần có hình của file')
  }
}

export async function createFreezeFrame(request: FreezeFrameRequest): Promise<MediaAsset> {
  const { source, sourceUs } = request
  if (!source.probe.hasVideo) throw new Error(`"${source.name}" không có hình để đóng băng`)

  const { mediaDir } = await ensureProjectDirs(request.projectId)
  const ms = Math.round(sourceUs / 1000)
  const fps = frameRateToNumber(request.frameRate)
  // Tên theo nội dung file gốc, mốc và nhịp khung: liên kết lại sang file khác hay
  // đổi nhịp khung dự án thì không dùng nhầm khung đứng hình cũ.
  const fingerprint = source.source.contentHash.slice(0, 12)
  const base = `${source.id}-${fingerprint}-freeze-${ms}ms-${fps}fps`
  const outputPath = join(mediaDir, `${base}.mp4`)
  const stillPath = join(mediaDir, `${base}.png`)
  const { ffmpegPath } = resolveFfmpegBinaries()

  if (!(await exists(outputPath))) {
    const tempPath = `${outputPath}.tmp.mp4`
    try {
      await extractFrameAtOrBefore(ffmpegPath, source.source.path, sourceUs, stillPath)
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
