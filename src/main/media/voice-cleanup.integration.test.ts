import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { importMediaFile } from './media-import-service'
import { detectSilences } from './silence-detection'
import { cleanVoice } from './voice-cleanup'

/**
 * Làm sạch giọng, đo bằng ffmpeg THẬT: tiếng "nói" (sine 300 Hz ở 1–2 s và 3–4 s)
 * nằm trên nhiễu trắng và tiếng ù 50 Hz. Điều cần chứng minh: nền nhiễu giảm hẳn,
 * lời nói còn nguyên, và tiếng KHÔNG lệch khỏi hình.
 */

const execFileAsync = promisify(execFile)
let workDir = ''
let source: MediaAsset
const projectId = createEmptyProject({ name: 'Thử làm sạch' }).id

async function meanVolumeDb(path: string, fromSeconds: number, toSeconds: number): Promise<number> {
  const { stderr } = await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
    '-hide_banner',
    '-nostats',
    '-i',
    path,
    '-vn',
    '-af',
    `atrim=${fromSeconds}:${toSeconds},volumedetect`,
    '-f',
    'null',
    '-'
  ])
  return Number(/mean_volume:\s*(-?[0-9.]+)/.exec(stderr)![1])
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-voice-'))
  const path = join(workDir, 'phong-on.mp4')
  await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=5',
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='0.4*sin(2*PI*300*t)*(between(t,1,2)+between(t,3,4))+0.05*sin(2*PI*50*t)':s=48000:d=5",
    '-f',
    'lavfi',
    '-i',
    'anoisesrc=color=white:amplitude=0.03:sample_rate=48000:duration=5',
    '-filter_complex',
    '[1][2]amix=inputs=2:normalize=0[a]',
    '-map',
    '0:v',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    path
  ])
  source = (await importMediaFile({ projectId, filePath: path }, [])).asset
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('cleanVoice', () => {
  it('hạ nền nhiễu ít nhất 6 dB mà lời nói gần như nguyên mức', async () => {
    const cleaned = await cleanVoice({ projectId, source, strength: 'medium', existing: [source] })
    expect(cleaned.kind).toBe('audio')
    expect(cleaned.generated).toMatchObject({ task: 'voice-cleanup', sourceAssetId: source.id })

    const noiseBefore = await meanVolumeDb(source.source.path, 0.3, 0.9)
    const noiseAfter = await meanVolumeDb(cleaned.source.path, 0.3, 0.9)
    expect(noiseBefore - noiseAfter).toBeGreaterThan(6)

    const speechBefore = await meanVolumeDb(source.source.path, 1.2, 1.8)
    const speechAfter = await meanVolumeDb(cleaned.source.path, 1.2, 1.8)
    expect(Math.abs(speechBefore - speechAfter)).toBeLessThan(2)
  })

  it('không lệch thời gian so với bản gốc (lệch là khẩu hình trễ tiếng)', async () => {
    const cleaned = await cleanVoice({ projectId, source, strength: 'medium', existing: [source] })
    const request = { startUs: 0, endUs: 5_000_000, noiseDb: -20, minSilenceUs: 300_000 }
    const before = await detectSilences({ ...request, sourcePath: source.source.path })
    const after = await detectSilences({ ...request, sourcePath: cleaned.source.path })
    expect(after).toHaveLength(before.length)
    for (const [index, silence] of before.entries()) {
      expect(Math.abs(after[index].endUs - silence.endUs)).toBeLessThan(30_000)
    }
    expect(Math.abs(cleaned.probe.durationUs - source.probe.durationUs)).toBeLessThan(50_000)
  })

  it('làm lại cùng mức thì dùng lại asset cũ, không thêm bản thứ hai', async () => {
    const first = await cleanVoice({ projectId, source, strength: 'light', existing: [source] })
    const again = await cleanVoice({
      projectId,
      source,
      strength: 'light',
      existing: [source, first]
    })
    expect(again.id).toBe(first.id)
  })
})
