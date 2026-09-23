import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { probeMediaFile } from './media-probe'
import { computeMediaContentHash } from './media-content-hash'
import { extractWaveformPeaks } from './media-waveform-extractor'
import { generateFilmstrip, generateThumbnail } from './media-thumbnail-generator'

/**
 * Kiểm thử tích hợp CHẠY THẬT ffmpeg trên file thật.
 *
 * Không giả lập ffmpeg: giá trị của lớp này nằm ở chỗ tham số dòng lệnh và cách
 * đọc kết quả có đúng hay không, mà đó chính là phần một bản giả lập sẽ che mất.
 */

const execFileAsync = promisify(execFile)

let workDir: string
let videoPath: string
let audioPath: string

beforeAll(async () => {
  const { ffmpegPath } = resolveFfmpegBinaries()
  workDir = await mkdtemp(join(tmpdir(), 'avs-media-test-'))
  videoPath = join(workDir, 'canh-quay.mp4')
  audioPath = join(workDir, 'nhac.mp3')

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=25:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=300:duration=6:sample_rate=48000',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-shortest',
    videoPath
  ])

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=4:sample_rate=48000',
    '-c:a',
    'libmp3lame',
    audioPath
  ])
}, 120_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('ffmpeg đi kèm', () => {
  it('có sẵn cả ffmpeg và ffprobe', () => {
    const binaries = resolveFfmpegBinaries()
    expect(binaries.ffmpegPath).toBeTruthy()
    expect(binaries.ffprobePath).toBeTruthy()
  })

  it('có filter phụ đề — bắt buộc để nung phụ đề tiếng Việt', async () => {
    // ffmpeg của Homebrew thường THIẾU libass, nên đây là điểm khác biệt quan trọng
    // giữa bản đi kèm và bản của hệ thống. Mất filter này thì burn-in hỏng âm thầm.
    const { ffmpegPath } = resolveFfmpegBinaries()
    const { stdout } = await execFileAsync(ffmpegPath, ['-hide_banner', '-filters'], {
      maxBuffer: 8 * 1024 * 1024
    })
    expect(stdout).toMatch(/\bsubtitles\b/)
    expect(stdout).toMatch(/\bdrawtext\b/)
  })
})

describe('probeMediaFile', () => {
  it('đọc đúng thời lượng, kích thước và fps của video', async () => {
    const { probe, kind } = await probeMediaFile(videoPath)
    expect(kind).toBe('video')
    expect(probe.hasVideo).toBe(true)
    expect(probe.hasAudio).toBe(true)
    expect(probe.width).toBe(640)
    expect(probe.height).toBe(360)
    expect(probe.frameRate).toEqual({ num: 25, den: 1 })
    // 6 giây, cho phép lệch 200ms do làm tròn container.
    expect(probe.durationUs).toBeGreaterThan(5_800_000)
    expect(probe.durationUs).toBeLessThan(6_200_000)
  })

  it('nhận diện file chỉ có âm thanh', async () => {
    const { probe, kind } = await probeMediaFile(audioPath)
    expect(kind).toBe('audio')
    expect(probe.hasVideo).toBe(false)
    expect(probe.hasAudio).toBe(true)
    expect(probe.audioSampleRate).toBe(48000)
  })

  it('báo lỗi rõ ràng với file không phải media', async () => {
    await expect(probeMediaFile(join(workDir, 'khong-ton-tai.mp4'))).rejects.toThrow()
  })
})

describe('computeMediaContentHash', () => {
  it('cùng một file cho cùng một hash', async () => {
    const first = await computeMediaContentHash(videoPath)
    const second = await computeMediaContentHash(videoPath)
    expect(first).toBe(second)
    expect(first).toHaveLength(64)
  })

  it('hai file khác nhau cho hash khác nhau', async () => {
    const videoHash = await computeMediaContentHash(videoPath)
    const audioHash = await computeMediaContentHash(audioPath)
    expect(videoHash).not.toBe(audioHash)
  })
})

describe('extractWaveformPeaks', () => {
  it('trích peak thật với số bucket khớp thời lượng', async () => {
    const outputPath = join(workDir, 'peaks.bin')
    const result = await extractWaveformPeaks(audioPath, outputPath)

    expect(result.bucketsPerSecond).toBe(100)
    // 4 giây ở 100 bucket/giây ~ 400 bucket; cho dao động vì mp3 có đệm đầu/cuối.
    expect(result.bucketCount).toBeGreaterThan(350)
    expect(result.bucketCount).toBeLessThan(460)

    const stats = await stat(outputPath)
    // Mỗi bucket ghi hai giá trị Int16 = 4 byte.
    expect(stats.size).toBe(result.bucketCount * 4)
  }, 60_000)
})

describe('sinh ảnh xem trước', () => {
  it('tạo được thumbnail', async () => {
    const outputPath = join(workDir, 'thumb.jpg')
    await generateThumbnail(videoPath, outputPath, 2_000_000)
    const stats = await stat(outputPath)
    expect(stats.size).toBeGreaterThan(1000)
  }, 60_000)

  it('tạo được filmstrip gồm nhiều frame ghép ngang', async () => {
    const outputPath = join(workDir, 'strip.jpg')
    const result = await generateFilmstrip(videoPath, outputPath, 6_000_000, 12)
    expect(result.frameCount).toBe(12)
    const stats = await stat(outputPath)
    expect(stats.size).toBeGreaterThan(1000)
  }, 60_000)

  it('filmstrip TRẢI theo cả clip, ô đầu khác ô cuối', async () => {
    // Đường nhanh chỉ giải mã keyframe, mà clip thử dài 6 giây chỉ có ĐÚNG MỘT
    // keyframe: không đủ frame để xếp kín ô, ffmpeg không ghi ra file nào mà vẫn
    // thoát với mã 0. Không lùi về giải mã đầy đủ thì hoặc mất hẳn filmstrip,
    // hoặc được một dải mười hai ô giống hệt nhau — nhìn thì vẫn ra "có ảnh".
    const outputPath = join(workDir, 'strip-trai.jpg')
    const { frameCount } = await generateFilmstrip(videoPath, outputPath, 6_000_000, 12)

    const tile = async (index: number): Promise<Buffer> => {
      const path = join(workDir, `tile-${index}.png`)
      const { ffmpegPath } = resolveFfmpegBinaries()
      await promisify(execFile)(ffmpegPath, [
        '-v',
        'error',
        '-y',
        '-i',
        outputPath,
        '-vf',
        `crop=iw/${frameCount}:ih:${index}*iw/${frameCount}:0`,
        '-frames:v',
        '1',
        path
      ])
      return readFile(path)
    }

    expect((await tile(0)).equals(await tile(frameCount - 1))).toBe(false)
  }, 60_000)
})
