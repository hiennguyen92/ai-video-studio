import { describe, expect, it } from 'vitest'
import {
  abortAllFfmpegProcesses,
  runTrackedProcess,
  runningProcessCount
} from './ffmpeg-process-registry'

describe('ffmpeg-process-registry', () => {
  it('huỷ hết: tiến trình đang chạy bị giết ngay, không chờ nó xong', async () => {
    const started = Date.now()
    const pending = runTrackedProcess('sleep', ['5'])
    expect(runningProcessCount()).toBe(1)
    abortAllFfmpegProcesses()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - started).toBeLessThan(2_000)
    expect(runningProcessCount()).toBe(0)
  })

  it('chạy xong bình thường thì tự rời sổ', async () => {
    const { stdout } = await runTrackedProcess('echo', ['xong'])
    expect(stdout.trim()).toBe('xong')
    expect(runningProcessCount()).toBe(0)
  })
})
