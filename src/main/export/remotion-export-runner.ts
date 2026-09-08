import { availableParallelism, totalmem } from 'node:os'
import { app } from 'electron'
import { join } from 'node:path'
import { bundle } from '@remotion/bundler'
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { buildRenderPlan } from '../../shared/domain/remotion-render-plan'
import { frameRateToNumber, type FrameRate } from '../../shared/domain/time-units'
import { localMediaUrl, registerMediaFiles } from '../media/local-media-server'

/**
 * Xuất video bằng Remotion.
 *
 * Dùng CHUNG composition với preview (`src/remotion/root.tsx` → `ProjectComposition`),
 * nên bản xuất không thể khác bản xem trước — thay vì phải giữ hai hiện thực khớp
 * nhau bằng tay như đường ffmpeg filter graph.
 *
 * Đổi lại là chậm hơn khoảng 6,7 lần (xem `docs/remotion-render-benchmark.md`).
 * Cái đổi được là chuyển cảnh và chữ động, những thứ filter graph không làm nổi.
 */

const GIB = 1024 ** 3
const MAX_RENDER_CONCURRENCY = 24

/**
 * Số tab render song song.
 *
 * Lấy theo cách OpenChatCut tinh chỉnh: bám 80% số lõi nhưng chặn theo RAM, vì
 * mỗi tab headless ngốn khoảng 1,25 GiB. Để mặc định thì máy ít RAM sẽ swap và
 * chậm hơn hẳn so với chạy ít tab.
 */
export function resolveRenderConcurrency(
  cores = availableParallelism(),
  memoryBytes = totalmem()
): number {
  if (cores <= 2) return 1
  const cpuTarget = Math.round(cores * 0.8)
  const memoryTarget = Math.max(1, Math.floor(((memoryBytes / GIB) * 0.5) / 1.25))
  return Math.max(1, Math.min(MAX_RENDER_CONCURRENCY, cpuTarget, memoryTarget))
}

/** OffthreadVideo ngốn bộ nhớ hơn nên chia dè dặt hơn số tab. */
export function resolveOffthreadVideoThreads(cores = availableParallelism()): number {
  if (cores <= 2) return 1
  return Math.max(2, Math.min(4, Math.ceil(cores / 4)))
}

export interface RemotionExportSettings {
  outputPath: string
  width: number
  height: number
  frameRate: FrameRate
  useHardwareEncoder: boolean
}

export interface RemotionExportHandle {
  done: Promise<{ status: 'succeeded' | 'cancelled'; outputPath: string }>
  cancel(): void
}

/** Bundle chỉ phụ thuộc mã nguồn nên dựng một lần rồi dùng lại cho mọi lần xuất. */
let cachedBundle: Promise<string> | null = null

function entryPoint(): string {
  // Trong bản đóng gói, mã Remotion nằm cạnh mã main đã build.
  return app.isPackaged
    ? join(process.resourcesPath, 'remotion', 'root.tsx')
    : join(app.getAppPath(), 'src', 'remotion', 'root.tsx')
}

async function ensureBundle(): Promise<string> {
  cachedBundle ??= bundle({ entryPoint: entryPoint(), onProgress: () => undefined })
  return cachedBundle
}

export function startRemotionExport(
  documentSnapshot: ProjectDocument,
  settings: RemotionExportSettings,
  onProgress: (progress: { ratio: number }) => void
): RemotionExportHandle {
  const { cancelSignal, cancel } = makeCancelSignal()
  let cancelled = false

  const done = (async () => {
    const plan = buildRenderPlan(documentSnapshot)
    // Kích thước xuất do người dùng chọn, có thể khác kích thước dự án.
    const scaledPlan = {
      ...plan,
      width: settings.width,
      height: settings.height,
      fps: settings.frameRate
    }

    // Đăng ký media rồi lấy URL http: bộ dựng khung hình là tiến trình riêng,
    // không đọc được đường dẫn đĩa.
    registerMediaFiles(
      documentSnapshot.assets.map((asset) => ({ id: asset.id, path: asset.source.path }))
    )
    const mediaUrls: Record<string, string> = {}
    for (const asset of documentSnapshot.assets) {
      const url = localMediaUrl(asset.id)
      if (url) mediaUrls[asset.id] = url
    }

    const serveUrl = await ensureBundle()
    const inputProps = { plan: scaledPlan, mediaUrls }

    const composition = await selectComposition({ serveUrl, id: 'project', inputProps })

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: settings.outputPath,
      inputProps,
      concurrency: resolveRenderConcurrency(),
      offthreadVideoThreads: resolveOffthreadVideoThreads(),
      chromiumOptions: { gl: process.platform === 'linux' ? 'angle-egl' : 'angle' },
      hardwareAcceleration: settings.useHardwareEncoder ? 'required' : 'disable',
      ...(settings.useHardwareEncoder ? { videoBitrate: '10M' } : { crf: 21 }),
      cancelSignal,
      onProgress: ({ progress }) => onProgress({ ratio: progress })
    })

    return { status: 'succeeded' as const, outputPath: settings.outputPath }
  })().catch((error: unknown) => {
    if (cancelled) return { status: 'cancelled' as const, outputPath: settings.outputPath }
    throw error
  })

  return {
    done,
    cancel: () => {
      cancelled = true
      cancel()
    }
  }
}

/** Nhịp hình dạng số cho Remotion; dự án lưu dạng phân số. */
export function exportFps(frameRate: FrameRate): number {
  return frameRateToNumber(frameRate)
}
