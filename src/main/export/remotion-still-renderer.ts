import { renderStill, selectComposition } from '@remotion/renderer'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { frameOfMicros, type FrameRate, type Micros } from '../../shared/domain/time-units'
import {
  ensureBundle,
  packagedBrowserExecutable,
  remotionInputProps
} from './remotion-export-runner'

/**
 * Xuất MỘT khung hình ra PNG — ảnh bìa, ảnh xem trước để đăng.
 *
 * Đi bằng `renderStill` của Remotion trên CÙNG composition với preview và bản
 * xuất video, nên ảnh ra đúng từng điểm ảnh với thứ người dùng thấy tại đầu phát:
 * chữ, effect, nền mờ, chuyển cảnh đều có. Chụp màn hình preview thì dính khung
 * điều khiển và ra đúng cỡ của khung preview chứ không phải cỡ video.
 */
export async function renderStillFrame(
  document: ProjectDocument,
  options: { atUs: Micros; width: number; height: number; frameRate: FrameRate; outputPath: string }
): Promise<string> {
  const inputProps = remotionInputProps(document, options)
  const serveUrl = await ensureBundle()
  const browserExecutable = packagedBrowserExecutable()
  const composition = await selectComposition({
    serveUrl,
    id: 'project',
    inputProps,
    browserExecutable
  })

  // Đầu phát ở sát mép cuối thì khung đó không còn trong composition.
  const frame = Math.min(
    Math.max(0, frameOfMicros(options.atUs, options.frameRate)),
    composition.durationInFrames - 1
  )
  await renderStill({
    composition,
    serveUrl,
    browserExecutable,
    frame,
    output: options.outputPath,
    imageFormat: 'png',
    inputProps,
    chromiumOptions: { gl: process.platform === 'linux' ? 'angle-egl' : 'angle' }
  })
  return options.outputPath
}
