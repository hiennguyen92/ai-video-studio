import { existsSync } from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeInstaller from '@ffprobe-installer/ffprobe'

/**
 * Định vị hai file nhị phân ffmpeg/ffprobe.
 *
 * Ứng dụng LUÔN dùng bản đi kèm chứ không dựa vào ffmpeg của máy người dùng:
 * ffmpeg cài qua Homebrew trên macOS thường build thiếu libass/freetype, tức là
 * không có filter `subtitles` — nung phụ đề vào video sẽ hỏng lặng lẽ.
 * Bản đi kèm đã bật libass, libfreetype và fontconfig.
 *
 * Khi đóng gói, electron-builder để file nhị phân trong `app.asar.unpacked`
 * vì tiến trình con không chạy được file nằm trong asar.
 */

function resolveUnpacked(binaryPath: string): string {
  if (binaryPath.includes('app.asar') && !binaryPath.includes('app.asar.unpacked')) {
    return binaryPath.replace('app.asar', 'app.asar.unpacked')
  }
  return binaryPath
}

export interface FfmpegBinaries {
  ffmpegPath: string
  ffprobePath: string
}

let cached: FfmpegBinaries | null = null

export function resolveFfmpegBinaries(): FfmpegBinaries {
  if (cached) return cached

  const ffmpegPath = resolveUnpacked(String(ffmpegStatic ?? ''))
  const ffprobePath = resolveUnpacked(ffprobeInstaller.path)

  if (!ffmpegPath || !existsSync(ffmpegPath)) {
    throw new Error(
      `Không tìm thấy ffmpeg đi kèm tại "${ffmpegPath}". Chạy lại "npm install" để tải file nhị phân.`
    )
  }
  if (!existsSync(ffprobePath)) {
    throw new Error(
      `Không tìm thấy ffprobe đi kèm tại "${ffprobePath}". Chạy lại "npm install" để tải file nhị phân.`
    )
  }

  cached = { ffmpegPath, ffprobePath }
  return cached
}
