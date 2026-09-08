import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEmptyProject, createId } from '../../shared/domain/project-document-factory'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleTrack } from '../../shared/domain/subtitle-types'
import { runCommands, createSessionState } from '../../shared/commands/command-history'
import { resolveFfmpegBinaries } from '../media/ffmpeg-binaries'
import { probeMediaFile } from '../media/media-probe'
import {
  buildExportCommand,
  splitTempoFactors,
  type ExportSettings
} from './timeline-filter-graph-builder'
import { startExport } from './export-job-runner'
import {
  formatSrtTime,
  renderAss,
  renderSrt,
  toAssColor,
  writeAssFile
} from './subtitle-file-writers'

/**
 * Kiểm thử xuất video: CHẠY THẬT ffmpeg và soi lại file kết quả.
 *
 * Chỉ so chuỗi tham số là chưa đủ — một filter graph sai cú pháp vẫn "trông đúng"
 * dưới dạng chuỗi. Ở đây file MP4 phải thật sự tồn tại, đúng thời lượng, đúng độ
 * phân giải và có cả hình lẫn tiếng.
 */

const execFileAsync = promisify(execFile)

let workDir: string
let videoPath: string
let audioPath: string

async function makeAsset(path: string): Promise<MediaAsset> {
  const { probe, kind } = await probeMediaFile(path)
  return {
    id: createId('asset'),
    kind,
    name: path.split('/').pop() ?? 'media',
    source: { path, contentHash: 'hash', sizeBytes: 1, mtimeMs: 0 },
    probe,
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: new Date().toISOString(),
    missing: false
  }
}

beforeAll(async () => {
  const { ffmpegPath } = resolveFfmpegBinaries()
  workDir = await mkdtemp(join(tmpdir(), 'avs-export-test-'))
  videoPath = join(workDir, 'canh-quay.mp4')
  audioPath = join(workDir, 'nhac.mp3')

  await execFileAsync(ffmpegPath, [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=640x360:rate=30:duration=6',
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
    'sine=frequency=440:duration=6:sample_rate=48000',
    '-c:a',
    'libmp3lame',
    audioPath
  ])
}, 180_000)

afterAll(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true })
})

/** Dự án mẫu: một clip video 4 giây và một clip nhạc 3 giây bắt đầu ở giây 1. */
async function buildSampleProject(): Promise<ProjectDocument> {
  const doc = createEmptyProject({ name: 'Xuất thử' })
  const videoAsset = await makeAsset(videoPath)
  const audioAsset = await makeAsset(audioPath)
  doc.assets.push(videoAsset, audioAsset)

  const videoTrack = doc.tracks.find((track) => track.kind === 'video')!
  const musicTrack = doc.tracks.find((track) => track.role === 'music')!

  const outcome = runCommands(
    createSessionState(doc),
    [
      {
        type: 'clip/insert',
        trackId: videoTrack.id,
        assetId: videoAsset.id,
        startUs: 0,
        durationUs: 4_000_000,
        sourceInUs: 1_000_000
      },
      {
        type: 'clip/insert',
        trackId: musicTrack.id,
        assetId: audioAsset.id,
        startUs: 1_000_000,
        durationUs: 3_000_000,
        sourceInUs: 0
      }
    ],
    'dựng dự án mẫu'
  )
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.state.document
}

function exportSettings(outputPath: string, assPath?: string): ExportSettings {
  return {
    outputPath,
    width: 640,
    height: 360,
    frameRate: { num: 30, den: 1 },
    sampleRate: 48000,
    crf: 28,
    hardwareBitrate: '4M',
    useHardwareEncoder: false,
    burnSubtitlesAssPath: assPath
  }
}

describe('buildExportCommand', () => {
  it('không chuẩn hoá âm lượng khi trộn — thêm track không làm nhỏ lời thoại', async () => {
    const doc = await buildSampleProject()
    const { args } = buildExportCommand(doc, exportSettings('/tmp/out.mp4'))
    const graph = args[args.indexOf('-filter_complex') + 1]
    expect(graph).toContain('normalize=0')
  })

  it('ép nhịp hình cố định để thời lượng không trôi', async () => {
    const doc = await buildSampleProject()
    const { args } = buildExportCommand(doc, exportSettings('/tmp/out.mp4'))
    expect(args).toContain('-fps_mode')
    expect(args[args.indexOf('-fps_mode') + 1]).toBe('cfr')
  })

  it('dời clip audio đúng vị trí bằng adelay tính theo mili giây', async () => {
    const doc = await buildSampleProject()
    const { args } = buildExportCommand(doc, exportSettings('/tmp/out.mp4'))
    const graph = args[args.indexOf('-filter_complex') + 1]
    // Clip nhạc bắt đầu ở giây thứ 1 = 1000 ms.
    expect(graph).toContain('adelay=1000:all=1')
  })

  it('chọn bitrate thay vì CRF khi dùng bộ mã hoá phần cứng', async () => {
    const doc = await buildSampleProject()
    const { args } = buildExportCommand(doc, {
      ...exportSettings('/tmp/out.mp4'),
      useHardwareEncoder: true
    })
    expect(args).toContain('h264_videotoolbox')
    expect(args).not.toContain('-crf')
  })
})

describe('splitTempoFactors', () => {
  it('giữ nguyên hệ số nằm trong giới hạn của atempo', () => {
    expect(splitTempoFactors(1.3)).toEqual([1.3])
  })

  it('tách hệ số vượt giới hạn thành nhiều tầng có tích đúng bằng nó', () => {
    for (const speed of [4, 3.5, 0.25]) {
      const factors = splitTempoFactors(speed)
      const product = factors.reduce((total, factor) => total * factor, 1)
      expect(product).toBeCloseTo(speed, 4)
      for (const factor of factors) {
        expect(factor).toBeGreaterThanOrEqual(0.5)
        expect(factor).toBeLessThanOrEqual(2)
      }
    }
  })
})

describe('file phụ đề', () => {
  it('màu ASS đảo về thứ tự BGR kèm alpha ở đầu', () => {
    // #FF8800 -> B=00, G=88, R=FF, alpha 00 = đặc hoàn toàn.
    expect(toAssColor('#FF8800')).toBe('&H000088FF')
    expect(toAssColor('#FFFFFF', 0)).toBe('&HFFFFFFFF')
  })

  it('SRT dùng dấu phẩy ngăn mili giây', () => {
    expect(formatSrtTime(3_661_500_000)).toBe('01:01:01,500')
  })

  it('giữ nguyên dấu tiếng Việt trong cả ASS lẫn SRT', () => {
    const track: SubtitleTrack = {
      id: 'sub1',
      name: 'Tiếng Việt',
      language: 'vi',
      source: { kind: 'manual' },
      style: DEFAULT_SUBTITLE_STYLE,
      cues: [
        {
          id: 'c1',
          startUs: 0,
          endUs: 2_000_000,
          text: 'Xin chào, đây là bản thử nghiệm tiếng Việt có đủ dấu.',
          edited: false
        }
      ]
    }

    const ass = renderAss(track, 1920, 1080)
    expect(ass).toContain('PlayResX: 1920')
    expect(ass).toContain('đủ dấu')
    expect(ass).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Chinh')

    const srt = renderSrt(track)
    expect(srt).toContain('00:00:00,000 --> 00:00:02,000')
    expect(srt).toContain('đủ dấu')
  })

  it('phụ đề song ngữ sinh hai dòng Dialogue với style khác nhau', () => {
    const track: SubtitleTrack = {
      id: 'sub2',
      name: 'Song ngữ',
      language: 'vi',
      secondaryLanguage: 'en',
      source: { kind: 'manual' },
      style: DEFAULT_SUBTITLE_STYLE,
      cues: [
        {
          id: 'c1',
          startUs: 0,
          endUs: 1_000_000,
          text: 'Xin chào',
          textSecondary: 'Hello',
          edited: false
        }
      ]
    }
    const ass = renderAss(track, 1920, 1080)
    expect(ass).toContain(',Chinh,')
    expect(ass).toContain(',Phu,')
  })
})

describe('xuất video thật', () => {
  it('tạo ra MP4 đúng thời lượng, độ phân giải và có cả hình lẫn tiếng', async () => {
    const doc = await buildSampleProject()
    const outputPath = join(workDir, 'ket-qua.mp4')

    const progressSamples: number[] = []
    const handle = startExport(doc, exportSettings(outputPath), (progress) => {
      if (progress.ratio !== undefined) progressSamples.push(progress.ratio)
    })

    const result = await handle.done
    expect(result.status).toBe('succeeded')

    const { probe } = await probeMediaFile(outputPath)
    expect(probe.hasVideo).toBe(true)
    expect(probe.hasAudio).toBe(true)
    expect(probe.width).toBe(640)
    expect(probe.height).toBe(360)
    // Timeline dài 4 giây; cho phép lệch 150ms do đóng gói container.
    expect(probe.durationUs).toBeGreaterThan(3_850_000)
    expect(probe.durationUs).toBeLessThan(4_150_000)

    // Tiến trình phải là số thật do ffmpeg báo, tăng dần chứ không nhảy cóc.
    expect(progressSamples.length).toBeGreaterThan(0)
    expect(progressSamples.at(-1)).toBeGreaterThan(0.5)
  }, 180_000)

  it('nung được phụ đề tiếng Việt vào hình', async () => {
    const doc = await buildSampleProject()
    const assPath = join(workDir, 'phu-de.ass')
    const outputPath = join(workDir, 'ket-qua-phu-de.mp4')

    await writeAssFile(
      {
        id: 'sub1',
        name: 'Tiếng Việt',
        language: 'vi',
        source: { kind: 'manual' },
        style: DEFAULT_SUBTITLE_STYLE,
        cues: [
          {
            id: 'c1',
            startUs: 0,
            endUs: 3_000_000,
            text: 'Nội dung thử nghiệm đầy đủ dấu',
            edited: false
          }
        ]
      },
      640,
      360,
      assPath
    )

    // File ASS phải là UTF-8 hợp lệ, nếu không libass sẽ vẽ ra ô vuông.
    const assContent = await readFile(assPath, 'utf8')
    expect(assContent).toContain('đầy đủ dấu')

    const handle = startExport(doc, exportSettings(outputPath, assPath), () => undefined)
    const result = await handle.done
    expect(result.status).toBe('succeeded')

    const { probe } = await probeMediaFile(outputPath)
    expect(probe.hasVideo).toBe(true)
  }, 180_000)

  it('huỷ giữa chừng dừng hẳn tiến trình', async () => {
    const doc = await buildSampleProject()
    const outputPath = join(workDir, 'bi-huy.mp4')

    const handle = startExport(doc, exportSettings(outputPath), () => undefined)
    // Huỷ NGAY, không hẹn giờ: một timeline ngắn mã hoá xong trong vài trăm mili
    // giây trên máy nhanh, nên hẹn giờ sẽ khiến phép thử lúc đạt lúc không.
    handle.cancel()

    const result = await handle.done
    expect(result.status).toBe('cancelled')
  }, 60_000)

  it('báo lỗi rõ ràng khi đường dẫn xuất không ghi được', async () => {
    const doc = await buildSampleProject()
    const handle = startExport(
      doc,
      exportSettings('/thu-muc-khong-ton-tai-abc/ket-qua.mp4'),
      () => undefined
    )
    await expect(handle.done).rejects.toThrow()
  }, 60_000)
})

describe('phông chữ khi nung phụ đề', () => {
  it('chỉ thẳng cho ffmpeg thư mục font khi có', async () => {
    const doc = await buildSampleProject()
    const settings = {
      ...exportSettings('/tmp/ra.mp4', '/tmp/phu-de.ass'),
      burnSubtitlesFontsDir: '/tmp/kho-phong'
    }
    const command = buildExportCommand(doc, settings)
    const graph = command.args.join(' ')

    // Không có `fontsdir`, libass tra font qua fontconfig và bản ffmpeg đi kèm có
    // thể không thấy phông hệ thống — nó LẶNG LẼ đổi sang phông mặc định, và bản
    // xuất khác hẳn bản xem trước.
    expect(graph).toContain("fontsdir='/tmp/kho-phong'")
  })

  it('không có thư mục font thì không thêm tham số rỗng', async () => {
    const doc = await buildSampleProject()
    const command = buildExportCommand(doc, exportSettings('/tmp/ra.mp4', '/tmp/phu-de.ass'))

    expect(command.args.join(' ')).not.toContain('fontsdir')
  })
})
