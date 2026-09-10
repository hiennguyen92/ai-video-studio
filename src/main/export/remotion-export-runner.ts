import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { app } from 'electron'
import { join } from 'node:path'
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

/**
 * Thư mục bundle dựng sẵn lúc build, chỉ có trong bản đóng gói.
 *
 * Bản đóng gói KHÔNG dựng lúc chạy được: mã nguồn `src/` bị loại khỏi gói, và các
 * gói phụ thuộc nằm trong `app.asar` mà bộ đóng gói của Remotion không đọc được
 * file bên trong asar. `scripts/bundle-remotion.mjs` dựng sẵn, electron-builder
 * chép vào Resources.
 */
function prebuiltBundleDir(): string | null {
  return app.isPackaged ? join(process.resourcesPath, 'remotion-bundle') : null
}

/**
 * Chrome Headless Shell đi kèm bản cài.
 *
 * Thiếu nó thì Remotion tự đi tải, và chỗ tải là một thư mục nó suy ra bằng cách
 * trèo ngược từ THƯ MỤC LÀM VIỆC để tìm `package.json`. Mở app từ Finder thì thư
 * mục làm việc là `/`, không có `package.json` nào ở trên, nên nó rơi về
 * `/.remotion` — thư mục gốc chỉ đọc, và lần xuất đầu tiên chết ngay.
 *
 * Trả `null` ở bản dev: lúc đó thư mục làm việc là gốc dự án, Remotion tự tìm
 * thấy bản trong `node_modules/.remotion` như thường lệ.
 */
function packagedBrowserExecutable(): string | null {
  if (!app.isPackaged) return null

  const dir = join(process.resourcesPath, 'chrome-headless-shell')
  const manifest = join(dir, 'binary-path.json')
  if (!existsSync(manifest)) {
    throw new Error(
      `Bản cài thiếu Chrome Headless Shell tại "${dir}". Bản build này đóng gói sai; hãy build lại.`
    )
  }

  // Đường dẫn do script lúc build ghi ra, không đoán theo nền tảng ở đây.
  const { binary } = JSON.parse(readFileSync(manifest, 'utf8')) as { binary: string }
  const path = join(dir, binary)
  if (!existsSync(path)) {
    throw new Error(`Bản cài thiếu file Chrome tại "${path}". Bản build này đóng gói sai.`)
  }
  return path
}

async function ensureBundle(): Promise<string> {
  const prebuilt = prebuiltBundleDir()
  if (prebuilt) {
    if (!existsSync(join(prebuilt, 'index.html'))) {
      // Báo ngay và nói rõ, thay vì để Remotion ngã với một lỗi mạng khó hiểu khi
      // nó cố mở một thư mục trống.
      throw new Error(
        `Bản cài thiếu bundle Remotion tại "${prebuilt}". Bản build này đóng gói sai; hãy build lại.`
      )
    }
    return prebuilt
  }

  // Nạp bộ đóng gói bằng import ĐỘNG, chỉ ở nhánh dev.
  //
  // Nạp tĩnh thì bản đóng gói cũng nạp theo, và chuỗi phụ thuộc của nó kéo tới
  // `react` — thứ chỉ là devDependency nên không có trong gói. Hậu quả đo được:
  // app đóng gói tắt ngay khi mở với "Cannot find module 'react'", không kịp mở
  // nổi một cửa sổ nào.
  cachedBundle ??= import('@remotion/bundler').then(({ bundle }) =>
    bundle({
      entryPoint: join(app.getAppPath(), 'src', 'remotion', 'root.tsx'),
      onProgress: () => undefined
    })
  )
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

    // Cùng một trình duyệt cho cả bước chọn composition lẫn bước dựng: để trống
    // một trong hai là nó lại đi tìm bản tải sẵn theo thư mục làm việc.
    const browserExecutable = packagedBrowserExecutable()

    const composition = await selectComposition({
      serveUrl,
      id: 'project',
      inputProps,
      browserExecutable
    })

    await renderMedia({
      composition,
      serveUrl,
      browserExecutable,
      codec: 'h264',
      outputLocation: settings.outputPath,
      inputProps,
      concurrency: resolveRenderConcurrency(),
      offthreadVideoThreads: resolveOffthreadVideoThreads(),
      chromiumOptions: { gl: process.platform === 'linux' ? 'angle-egl' : 'angle' },
      // 'if-possible' chứ KHÔNG phải 'required'.
      //
      // Remotion dựng hình bằng FFmpeg riêng của nó, không phải bản ffmpeg-static
      // đi kèm ứng dụng — mà phần dò năng lực lại hỏi bản đi kèm. Trên macOS bản
      // đi kèm CÓ h264_videotoolbox còn bản của Remotion thì KHÔNG, nên ô "tăng
      // tốc phần cứng" tự bật rồi cả lần xuất chết với "Hardware encoder is not
      // available in your FFmpeg build".
      //
      // 'if-possible' biến một tối ưu không có sẵn thành lùi về mã hoá phần mềm,
      // thay vì giết cả bản dựng.
      hardwareAcceleration: settings.useHardwareEncoder ? 'if-possible' : 'disable',
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
