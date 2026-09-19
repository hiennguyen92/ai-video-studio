import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { resolveFfmpegBinaries } from './ffmpeg-binaries'
import { createFreezeFrame, FREEZE_ASSET_US } from './freeze-frame'
import { importMediaFile } from './media-import-service'

/**
 * Đóng băng khung, đo bằng ffmpeg THẬT trên `testsrc2` — nguồn đổi hình ở MỌI khung.
 * Điều cần chứng minh: đoạn đứng hình đúng là khung tại mốc đã chọn (không phải khung
 * kề bên), và nó đứng yên suốt chiều dài.
 */

const execFileAsync = promisify(execFile)
let workDir = ''
let source: MediaAsset
const projectId = createEmptyProject({ name: 'Thử đứng hình' }).id
const FPS = { num: 30, den: 1 }

/**
 * PSNR (dB) giữa khung số `aFrame` của file A và khung số `bFrame` của file B.
 *
 * Chọn khung theo CHỈ SỐ (`select=eq(n,…)`) chứ không tua bằng `-ss`: tua theo
 * giây có thể trượt một khung, và phép đo trượt thì không phân biệt được "đóng
 * băng sai khung" với "đo sai khung".
 */
async function psnr(a: string, aFrame: number, b: string, bFrame: number): Promise<number> {
  const { stderr } = await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
    '-hide_banner',
    '-i',
    a,
    '-i',
    b,
    '-filter_complex',
    `[0:v]select=eq(n\\,${aFrame}),setpts=PTS-STARTPTS[x];[1:v]select=eq(n\\,${bFrame}),setpts=PTS-STARTPTS[y];[x][y]psnr`,
    '-frames:v',
    '1',
    '-f',
    'null',
    '-'
  ])
  const value = /average:(inf|[0-9.]+)/.exec(stderr)![1]
  return value === 'inf' ? Infinity : Number(value)
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'avs-freeze-'))
  const path = join(workDir, 'chay.mp4')
  await execFileAsync(resolveFfmpegBinaries().ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=320x180:rate=30:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '12',
    '-pix_fmt',
    'yuv420p',
    path
  ])
  source = (await importMediaFile({ projectId, filePath: path }, [])).asset
})

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

describe('createFreezeFrame', () => {
  it('đúng khung tại mốc, đứng yên suốt chiều dài, dài đủ để kéo giãn', async () => {
    const frozen = await createFreezeFrame({
      projectId,
      source,
      sourceUs: 2_000_000,
      frameRate: FPS,
      existing: [source]
    })
    expect(frozen.kind).toBe('video')
    expect(frozen.generated).toMatchObject({ task: 'freeze-frame', sourceAssetId: source.id })
    expect(Math.abs(frozen.probe.durationUs - FREEZE_ASSET_US)).toBeLessThan(100_000)

    // Đứng yên: khung đầu và khung gần cuối giống hệt nhau.
    // Đứng yên: khung đầu và khung gần cuối như nhau (sai khác chỉ do nén có mất
    // mát; hai khung kề nhau của nguồn chênh nhau cỡ 24 dB).
    expect(await psnr(frozen.source.path, 0, frozen.source.path, 270)).toBeGreaterThan(40)

    // Đúng khung: 2 s ở 30 fps là khung số 60 — giống nó, không giống khung kề bên.
    const exact = await psnr(frozen.source.path, 30, source.source.path, 60)
    expect(exact).toBeGreaterThan(38)
    expect(exact).toBeGreaterThan((await psnr(frozen.source.path, 30, source.source.path, 59)) + 10)
    expect(exact).toBeGreaterThan((await psnr(frozen.source.path, 30, source.source.path, 61)) + 10)
  })

  it('đóng băng lại đúng mốc cũ thì dùng lại asset, không dựng lần hai', async () => {
    const first = await createFreezeFrame({
      projectId,
      source,
      sourceUs: 3_000_000,
      frameRate: FPS,
      existing: [source]
    })
    const again = await createFreezeFrame({
      projectId,
      source,
      sourceUs: 3_000_000,
      frameRate: FPS,
      existing: [source, first]
    })
    expect(again.id).toBe(first.id)
  })
})
