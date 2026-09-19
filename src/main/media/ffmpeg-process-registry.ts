import { execFile, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'

/**
 * Các tiến trình ffmpeg/ffprobe chạy ngắn do người dùng bấm (làm sạch giọng, đóng
 * băng khung, tìm khoảng lặng, đo mức âm) — gom lại để huỷ được cùng lúc.
 *
 * Thoát app giữa lúc lọc một file dài thì ffmpeg con vẫn chạy tiếp sau khi app
 * đã tắt, ăn CPU và ghi dở một file tạm không ai dọn. Mỗi lần chạy mang một
 * AbortSignal; `abortAllFfmpegProcesses` giết hết khi app thoát, và nhánh `finally`
 * của từng nơi gọi xoá file tạm của nó như với mọi lỗi khác.
 */

const execFileAsync = promisify(execFile)
const running = new Set<AbortController>()

export async function runTrackedProcess(
  file: string,
  args: readonly string[],
  options: Omit<ExecFileOptions, 'signal' | 'encoding'> = {}
): Promise<{ stdout: string; stderr: string }> {
  const controller = new AbortController()
  running.add(controller)
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      ...options,
      encoding: 'utf8',
      signal: controller.signal
    })
    return { stdout, stderr }
  } finally {
    running.delete(controller)
  }
}

/** Số tiến trình đang chạy — cho phép thử. */
export function runningProcessCount(): number {
  return running.size
}

export function abortAllFfmpegProcesses(): void {
  for (const controller of running) controller.abort()
  running.clear()
}
