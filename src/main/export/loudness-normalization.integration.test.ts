import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'
import {
  measureLoudness,
  normalizeLoudnessInPlace,
  parseLoudnormJson
} from './loudness-normalization'

/**
 * Chuẩn hoá độ to, đo bằng ffmpeg THẬT trên file ra: điều cần chứng minh là file
 * sau khi xử lý thật sự nằm ở mức đích, và luồng hình không bị động tới.
 */

const execFileAsync = promisify(execFile)
let workDir = ''

async function ffmpeg(args: string[]): Promise<void> {
  await execFileAsync(resolveFfmpegBinaries().ffmpegPath, ['-v', 'error', '-y', ...args])
}

async function videoWithTone(name: string, volume: number): Promise<string> {
  const path = join(workDir, name)
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=300:duration=6,volume=${volume}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    path
  ])
  return path
}

async function probe(path: string): Promise<{ codec: string; frames: string; sampleRate: string }> {
  const { stdout } = await execFileAsync(resolveFfmpegBinaries().ffprobePath, [
    '-v',
    'error',
    '-count_packets',
    '-show_entries',
    'stream=codec_type,codec_name,nb_read_packets,sample_rate',
    '-of',
    'json',
    path
  ])
  const streams = (JSON.parse(stdout) as { streams: Array<Record<string, string>> }).streams
  const video = streams.find((item) => item.codec_type === 'video')!
  const audio = streams.find((item) => item.codec_type === 'audio')!
  return { codec: video.codec_name, frames: video.nb_read_packets, sampleRate: audio.sample_rate }
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-loudness-'))
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('normalizeLoudnessInPlace', () => {
  it('kéo file nhỏ tiếng lên đúng -14 LUFS, chép nguyên luồng hình, giữ 48 kHz', async () => {
    const path = await videoWithTone('nho.mp4', 0.02)
    const before = await probe(path)
    expect((await measureLoudness(path, -14))!.inputI).toBeLessThan(-40)

    const outcome = await normalizeLoudnessInPlace(path, -14, 48_000)
    expect(outcome.status).toBe('normalized')

    const after = await measureLoudness(path, -14)
    expect(Math.abs(after!.inputI - -14)).toBeLessThan(1)
    const probed = await probe(path)
    expect(probed.frames).toBe(before.frames)
    expect(probed.codec).toBe('h264')
    expect(probed.sampleRate).toBe('48000')
  })

  it('hạ file quá to xuống mức podcast -16 LUFS', async () => {
    const path = await videoWithTone('to.mp4', 0.9)
    await normalizeLoudnessInPlace(path, -16, 48_000)
    expect(Math.abs((await measureLoudness(path, -16))!.inputI - -16)).toBeLessThan(1)
  })

  it('bỏ qua file không có tiếng và file im hoàn toàn', async () => {
    const mute = join(workDir, 'khong-tieng.mp4')
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=30:duration=1',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      mute
    ])
    expect(await normalizeLoudnessInPlace(mute, -14, 48_000)).toEqual({
      status: 'skipped',
      reason: 'no-audio'
    })

    const silent = await videoWithTone('im.mp4', 0)
    expect(await normalizeLoudnessInPlace(silent, -14, 48_000)).toEqual({
      status: 'skipped',
      reason: 'silent'
    })
  })

  it('huỷ giữa chừng thì file cũ còn nguyên, không để lại file tạm', async () => {
    const path = await videoWithTone('huy.mp4', 0.02)
    const controller = new AbortController()
    controller.abort()
    await expect(normalizeLoudnessInPlace(path, -14, 48_000, controller.signal)).rejects.toThrow()
    expect((await measureLoudness(path, -14))!.inputI).toBeLessThan(-40)
  })
})

describe('parseLoudnormJson', () => {
  it('đọc số -inf của file im thành -Infinity', () => {
    expect(parseLoudnormJson('x\n{ "input_i" : "-inf", "input_tp" : "-inf" }')?.inputI).toBe(
      -Infinity
    )
  })
})
