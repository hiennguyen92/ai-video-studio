import { describe, expect, it } from 'vitest'
import {
  aspectForSource,
  canvasSizeForLongEdge,
  canvasSizeForSource,
  longEdgeForShortEdge,
  matchCanvasToSourceCommands,
  shortEdgeOf
} from './canvas-size'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject, createId } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import type { MediaAsset } from './media-asset-types'

/**
 * Kích thước khung dự án.
 *
 * Chỗ hỏng cũ: mỗi tỉ lệ khoá cứng một bộ số 1080, nên nguồn 4K vào thì bản xuất
 * vẫn ra 1080p — mà ô "Độ phân giải" lại ghi 100%. Người dùng yên tâm là không
 * mất gì trong lúc vừa vứt đi ba phần tư số điểm ảnh họ quay được.
 */

function asset(width?: number, height?: number, kind: MediaAsset['kind'] = 'video'): MediaAsset {
  return {
    id: 'asset_1',
    kind,
    name: 'canh.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true, width, height },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push(asset(2160, 3840))
  return document
}

function addClip(document: ProjectDocument): void {
  const track = document.tracks.find((item) => item.kind === 'video')!
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId: createId('clip'),
    trackId: track.id,
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 3_000_000,
    sourceInUs: 0
  })
  if (!result.ok) throw new Error(result.error)
}

describe('kích thước khung theo cạnh dài', () => {
  it('cho ra bộ số quen thuộc ở mọi tỉ lệ', () => {
    expect(canvasSizeForLongEdge('16:9', 1920)).toEqual({ width: 1920, height: 1080 })
    expect(canvasSizeForLongEdge('9:16', 1920)).toEqual({ width: 1080, height: 1920 })
    expect(canvasSizeForLongEdge('16:9', 3840)).toEqual({ width: 3840, height: 2160 })
    expect(canvasSizeForLongEdge('9:16', 3840)).toEqual({ width: 2160, height: 3840 })
    expect(canvasSizeForLongEdge('1:1', 1080)).toEqual({ width: 1080, height: 1080 })
  })

  it('hai cạnh luôn CHẴN', () => {
    // h264 với yuv420p không mã hoá được cạnh lẻ, và lỗi đó chỉ lộ ra lúc xuất,
    // khi người dùng đã dựng xong cả video.
    for (const longEdge of [721, 1081, 1443, 2161, 3841]) {
      for (const aspect of ['16:9', '9:16', '1:1'] as const) {
        const size = canvasSizeForLongEdge(aspect, longEdge)
        expect(size.width % 2, `${aspect}/${longEdge}`).toBe(0)
        expect(size.height % 2, `${aspect}/${longEdge}`).toBe(0)
      }
    }
  })

  it('cạnh ngắn quy ra cạnh dài rồi quay về đúng chính nó', () => {
    for (const shortEdge of [720, 1080, 1440, 2160]) {
      for (const aspect of ['16:9', '9:16', '1:1'] as const) {
        const size = canvasSizeForLongEdge(aspect, longEdgeForShortEdge(aspect, shortEdge))
        expect(shortEdgeOf(size), `${aspect}/${shortEdge}`).toBe(shortEdge)
      }
    }
  })
})

describe('tỉ lệ gần nhất với nguồn', () => {
  it('ngang ra ngang, dọc ra dọc, vuông ra vuông', () => {
    expect(aspectForSource(3840, 2160)).toBe('16:9')
    expect(aspectForSource(2160, 3840)).toBe('9:16')
    expect(aspectForSource(1080, 1080)).toBe('1:1')
  })

  it('4:3 vẫn là khung NGANG, không quy về vuông', () => {
    // Quy 4:3 về 1:1 là tự dưng cắt mất hai bên của thứ người dùng vừa quay.
    expect(aspectForSource(1440, 1080)).toBe('16:9')
    expect(aspectForSource(1080, 1440)).toBe('9:16')
  })
})

describe('khung khớp theo nguồn', () => {
  it('nguồn 4K dọc cho khung 4K dọc, không thu nhỏ', () => {
    expect(canvasSizeForSource(2160, 3840)).toEqual({
      aspectRatio: '9:16',
      width: 2160,
      height: 3840
    })
  })

  it('khung chỉ đi LÊN theo nguồn, không đi xuống', () => {
    // Cỡ chữ mặc định tính bằng pixel của khung và được chọn cho khung cao 1080.
    // Hạ khung theo nguồn 360p thì chữ 84px thành 23% chiều cao khung, tràn ra
    // ngoài và bóp méo khung nền — nhưng HƯỚNG khung thì vẫn phải sửa cho đúng.
    expect(canvasSizeForSource(720, 1280)).toEqual({
      aspectRatio: '9:16',
      width: 1080,
      height: 1920
    })
    expect(canvasSizeForSource(640, 360)).toEqual({
      aspectRatio: '16:9',
      width: 1920,
      height: 1080
    })
  })

  it('chặn trên ở 4K: nguồn 8K không kéo cả máy quỳ theo', () => {
    expect(shortEdgeOf(canvasSizeForSource(7680, 4320))).toBe(2160)
  })
})

describe('khớp khung theo clip hình đầu tiên', () => {
  it('nguồn 1080 ngang thì khung giữ nguyên, không phát lệnh thừa', () => {
    const document = project()
    document.assets[0].probe.width = 1920
    document.assets[0].probe.height = 1080
    expect(matchCanvasToSourceCommands(document, document.assets[0])).toEqual([])
  })

  it('timeline còn trống thì đổi khung theo nguồn', () => {
    const document = project()
    const [command] = matchCanvasToSourceCommands(document, document.assets[0])
    expect(command).toEqual({
      type: 'project/set-settings',
      settings: { aspectRatio: '9:16', width: 2160, height: 3840 }
    })
  })

  it('đã có clip hình rồi thì KHÔNG đổi nữa', () => {
    // Đổi khung ở clip thứ hai là dời chỗ mọi chữ và mọi clip đã dựng.
    const document = project()
    addClip(document)
    expect(matchCanvasToSourceCommands(document, document.assets[0])).toEqual([])
  })

  it('khung đang dùng vốn đã khớp thì không phát lệnh thừa', () => {
    const document = project()
    document.settings = { ...document.settings, aspectRatio: '9:16', width: 2160, height: 3840 }
    expect(matchCanvasToSourceCommands(document, document.assets[0])).toEqual([])
  })

  it('nguồn không có kích thước thì bỏ qua', () => {
    const document = project()
    expect(matchCanvasToSourceCommands(document, asset(undefined, undefined))).toEqual([])
    expect(matchCanvasToSourceCommands(document, asset(1920, 1080, 'audio'))).toEqual([])
  })
})
