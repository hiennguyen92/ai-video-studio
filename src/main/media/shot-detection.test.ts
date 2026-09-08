import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import {
  buildShots,
  detectSceneChanges,
  extractShotFrames,
  parseSceneChangeSeconds
} from './shot-detection'

/**
 * Phát hiện cú máy trong footage thô.
 *
 * Đây là đường DUY NHẤT để agent dựng được video từ footage không có tiếng — nơi
 * transcript rỗng và không có gì để đọc. Nên nó được kiểm bằng ffmpeg chạy thật
 * trên một video có các cú máy dựng sẵn, không phải bằng đầu ra giả lập.
 */

const execFileAsync = promisify(execFile)

let workDir: string
let clipPath: string

/** Bốn cú máy màu khác nhau, mỗi cú 2 giây — ranh giới nằm ở giây 2, 4, 6. */
beforeAll(async () => {
  const { ffmpegPath } = resolveFfmpegBinaries()
  workDir = await mkdtemp(join(tmpdir(), 'avs-shots-'))
  clipPath = join(workDir, 'review.mp4')

  const parts: string[] = []
  for (const [index, color] of ['red', 'blue', 'green', 'yellow'].entries()) {
    const part = join(workDir, `part-${index}.mp4`)
    await execFileAsync(ffmpegPath, [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=${color}:size=640x360:rate=30:duration=2`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-preset',
      'ultrafast',
      part
    ])
    parts.push(`file '${part}'`)
  }

  const listPath = join(workDir, 'list.txt')
  await writeFile(listPath, parts.join('\n'), 'utf8')
  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    clipPath
  ])
}, 180_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('parseSceneChangeSeconds', () => {
  it('đọc được đúng định dạng metadata=print của ffmpeg', () => {
    // Đầu ra thật, chép từ một lần chạy.
    const output = [
      'frame:0    pts:30720   pts_time:2',
      'lavfi.scene_score=0.400000',
      'frame:1    pts:61440   pts_time:4',
      'lavfi.scene_score=0.400000'
    ].join('\n')

    expect(parseSceneChangeSeconds(output)).toEqual([2, 4])
  })

  it('bỏ mốc trùng và sắp xếp tăng dần', () => {
    const output = 'pts_time:4\npts_time:2\npts_time:4'
    expect(parseSceneChangeSeconds(output)).toEqual([2, 4])
  })

  it('bỏ qua mốc 0 — cú đầu không phải một lần chuyển cảnh', () => {
    expect(parseSceneChangeSeconds('pts_time:0\npts_time:3')).toEqual([3])
  })

  it('không ngã khi đầu ra rỗng hoặc lạ', () => {
    expect(parseSceneChangeSeconds('')).toEqual([])
    expect(parseSceneChangeSeconds('không có gì ở đây')).toEqual([])
  })
})

describe('buildShots', () => {
  it('cú đầu luôn bắt đầu từ 0 và cú cuối chạy tới hết video', () => {
    const shots = buildShots([2, 4], 6_000_000)

    expect(shots.map((shot) => [shot.startUs, shot.endUs])).toEqual([
      [0, 2_000_000],
      [2_000_000, 4_000_000],
      [4_000_000, 6_000_000]
    ])
  })

  it('gộp mảnh vụn vào cú trước thay vì tạo cú dài vài phần trăm giây', () => {
    // Chớp sáng ở 2,05s không phải một cú máy.
    const shots = buildShots([2, 2.05, 4], 6_000_000)
    expect(shots).toHaveLength(3)
    expect(shots[1].startUs).toBe(2_000_000)
  })

  it('nhập cú cuối quá ngắn vào cú trước', () => {
    const shots = buildShots([2, 5.9], 6_000_000)
    expect(shots).toHaveLength(2)
    expect(shots[1].endUs).toBe(6_000_000)
  })

  it('bỏ mốc nằm ngoài thời lượng', () => {
    expect(buildShots([99], 6_000_000)).toHaveLength(1)
  })

  it('video rỗng thì không có cú nào', () => {
    expect(buildShots([], 0)).toEqual([])
  })

  it('không có mốc nào thì cả video là một cú', () => {
    expect(buildShots([], 6_000_000)).toEqual([{ index: 0, startUs: 0, endUs: 6_000_000 }])
  })
})

describe('chạy thật trên video có cú máy dựng sẵn', () => {
  it('tìm đúng ba ranh giới của bốn cú máy', async () => {
    const boundaries = await detectSceneChanges(clipPath)

    // Ranh giới ở giây 2, 4, 6 — cho phép lệch nhỏ do làm tròn khung hình.
    expect(boundaries).toHaveLength(3)
    for (const [index, expected] of [2, 4, 6].entries()) {
      expect(Math.abs(boundaries[index] - expected)).toBeLessThan(0.2)
    }
  }, 120_000)

  it('dựng ra đúng bốn cú máy', async () => {
    const boundaries = await detectSceneChanges(clipPath)
    const shots = buildShots(boundaries, 8_000_000)

    expect(shots).toHaveLength(4)
    expect(shots[0].startUs).toBe(0)
    expect(shots[3].endUs).toBe(8_000_000)
  }, 120_000)

  it('trích được ảnh đại diện cho từng cú, lấy ở giữa cú', async () => {
    const boundaries = await detectSceneChanges(clipPath)
    const shots = buildShots(boundaries, 8_000_000)
    const withFrames = await extractShotFrames(clipPath, shots, join(workDir, 'frames'))

    expect(withFrames).toHaveLength(4)

    const { default: ffprobeInstaller } = await import('@ffprobe-installer/ffprobe')
    const contents: string[] = []

    for (const shot of withFrames) {
      expect(shot.framePath).toBeTruthy()

      // Kiểm ảnh GIẢI MÃ ĐƯỢC và đúng bề ngang, thay vì so kích thước file với
      // một con số tuỳ tiện: một khung màu trơn nén xuống chưa tới 1 KB.
      const { stdout } = await execFileAsync(ffprobeInstaller.path, [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        shot.framePath as string
      ])
      const probed = JSON.parse(stdout) as { streams: Array<{ width?: number }> }
      expect(probed.streams[0]?.width).toBe(480)

      contents.push((await readFile(shot.framePath as string)).toString('base64'))
    }

    // Mỗi cú phải ra một ảnh KHÁC nhau. Giống nhau nghĩa là đang trích nhầm cùng
    // một mốc thời gian cho mọi cú, và agent sẽ chọn cảnh bằng bốn ảnh y hệt.
    expect(new Set(contents).size).toBe(4)
  }, 180_000)
})
