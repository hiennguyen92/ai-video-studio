import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { documentForExportRange, markerSections } from './export-range'
import { hardwareBitrate } from './export-presets'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { createDefaultTextOverlayStyle, type TextOverlay } from './text-overlay-types'
import { rippleTextOverlays } from './text-overlay-ripple'
import { resolveKeyframeTrack, valueAtFrame } from './keyframe-interpolation'

function overlay(
  id: string,
  startUs: number,
  endUs: number,
  extra: Partial<TextOverlay> = {}
): TextOverlay {
  return {
    id,
    text: id,
    startUs,
    endUs,
    style: createDefaultTextOverlayStyle(),
    animation: 'none',
    animationDurationUs: 0,
    ...extra
  } as TextOverlay
}

describe('rippleTextOverlays', () => {
  it('xoá chữ nằm trọn trong khoảng, dời chữ phía sau, co chữ vắt qua', () => {
    const result = rippleTextOverlays(
      [
        overlay('truoc', 0, 1_000_000),
        overlay('trong', 3_000_000, 4_000_000),
        overlay('vat-dau', 1_000_000, 3_000_000),
        overlay('vat-cuoi', 4_500_000, 7_000_000),
        overlay('sau', 8_000_000, 9_000_000)
      ],
      2_000_000,
      5_000_000
    )
    expect(result.map((item) => [item.id, item.startUs, item.endUs])).toEqual([
      ['truoc', 0, 1_000_000],
      ['vat-dau', 1_000_000, 2_000_000],
      ['vat-cuoi', 2_000_000, 4_000_000],
      ['sau', 5_000_000, 6_000_000]
    ])
  })

  it('cắt mất mép đầu thì keyframe dời theo, chuyển động vẫn khớp hình còn lại', () => {
    const [result] = rippleTextOverlays(
      [
        overlay('chu', 4_000_000, 8_000_000, {
          keyframes: { 'style.fontSizePx': [{ atUs: 2_000_000, v: 80 }] }
        })
      ],
      3_000_000,
      5_000_000
    )
    // Mép đầu mất 1 s: keyframe ở giây thứ 2 của chữ giờ là giây thứ 1.
    expect(result.keyframes?.['style.fontSizePx']?.[0].atUs).toBe(1_000_000)
  })

  it('cắt giữa chữ thì keyframe phía sau khoảng cắt lùi theo, phía trước giữ nguyên', () => {
    const [result] = rippleTextOverlays(
      [
        overlay('chu', 0, 10_000_000, {
          keyframes: {
            'style.fontSizePx': [
              { atUs: 1_000_000, v: 40 },
              { atUs: 8_000_000, v: 80 }
            ]
          }
        })
      ],
      3_000_000,
      5_000_000
    )
    expect([result.startUs, result.endUs]).toEqual([0, 8_000_000])
    // Hai keyframe gốc giữ đúng chỗ (8 s lùi về 6 s); chỗ nối ở 3 s thêm một cặp
    // mốc sát nhau để giá trị NHẢY thay vì nội suy lại cả đoạn.
    expect(result.keyframes?.['style.fontSizePx']?.map((frame) => frame.atUs)).toEqual([
      1_000_000, 3_000_000, 3_000_001, 6_000_000
    ])
  })
})

describe('keyframe chữ khi cắt giữa', () => {
  it('đoạn TRƯỚC khoảng cắt giữ nguyên dáng; sau mốc cắt tiếp tục từ giá trị ở cuối khoảng', () => {
    // Độ mờ 0 ở 0 s, vẫn 0 ở 4 s, lên 1 ở 6 s, giữ 1 tới 10 s. Cắt 4–6 s.
    const [result] = rippleTextOverlays(
      [
        overlay('chu', 0, 10_000_000, {
          keyframes: {
            'style.opacity': [
              { atUs: 0, v: 0 },
              { atUs: 4_000_000, v: 0 },
              { atUs: 6_000_000, v: 1 },
              { atUs: 10_000_000, v: 1 }
            ]
          }
        })
      ],
      4_000_000,
      6_000_000
    )
    const at = (us: number): number =>
      valueAtFrame(
        resolveKeyframeTrack(result.keyframes!['style.opacity'], { num: 1_000_000, den: 1 }),
        us,
        -1
      )
    // Trước đây: keyframe ở 6 s đè keyframe ở 4 s, đoạn 0–4 s mờ dần 0 → 1.
    expect(at(2_000_000)).toBe(0)
    expect(at(3_999_000)).toBe(0)
    // Từ mốc cắt trở đi là phần sau 6 s: đã hiện hẳn.
    expect(at(4_000_001)).toBe(1)
    expect(at(7_000_000)).toBe(1)
  })
})

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'audio',
    name: 'a.wav',
    source: { path: '/tmp/a.wav', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  applyEditorCommand(document, {
    type: 'clip/insert',
    clipId: 'dai',
    trackId: document.tracks[1].id,
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 20_000_000,
    sourceInUs: 0
  })
  applyEditorCommand(document, {
    type: 'text/add',
    overlay: overlay('hook', 12_000_000, 14_000_000)
  })
  applyEditorCommand(document, {
    type: 'marker/add',
    marker: { id: 'm', atUs: 11_000_000, label: 'Phần 2', color: 'blue' }
  })
  return document
}

describe('documentForExportRange', () => {
  it('chỉ còn đúng đoạn 10–15 s, dời về 0; clip, chữ và marker cắt theo cùng một luật', () => {
    const document = project()
    const sliced = documentForExportRange(document, { startUs: 10_000_000, endUs: 15_000_000 })

    const clip = sliced.tracks[1].clips[0]
    expect([clip.startUs, clip.durationUs, clip.sourceInUs]).toEqual([0, 5_000_000, 10_000_000])
    expect(sliced.textOverlays.map((item) => [item.startUs, item.endUs])).toEqual([
      [2_000_000, 4_000_000]
    ])
    expect(sliced.markers[0].atUs).toBe(1_000_000)
  })

  it('không đụng tới tài liệu gốc', () => {
    const document = project()
    documentForExportRange(document, { startUs: 10_000_000, endUs: 15_000_000 })
    expect(document.tracks[1].clips[0].durationUs).toBe(20_000_000)
    expect(document.textOverlays[0].startUs).toBe(12_000_000)
  })

  it('lane bị khoá vẫn được cắt — khoá chống sửa nhầm, không loại lane khỏi file xuất', () => {
    const document = project()
    document.tracks[1].locked = true
    const sliced = documentForExportRange(document, { startUs: 10_000_000, endUs: 15_000_000 })
    expect(sliced.tracks[1].clips[0].durationUs).toBe(5_000_000)
  })

  it('từ chối đoạn rỗng', () => {
    expect(() => documentForExportRange(project(), { startUs: 5, endUs: 5 })).toThrow()
  })
})

describe('markerSections', () => {
  it('mỗi marker mở một đoạn chạy tới marker kế, đoạn cuối tới hết video', () => {
    const sections = markerSections(
      [
        { id: 'b', atUs: 30_000_000, label: 'Hai', color: 'blue' },
        { id: 'a', atUs: 0, label: 'Một', color: 'red' }
      ],
      50_000_000
    )
    expect(sections.map((item) => [item.markerId, item.startUs, item.endUs])).toEqual([
      ['a', 0, 30_000_000],
      ['b', 30_000_000, 50_000_000]
    ])
  })
})

describe('markerSections — marker trùng mốc', () => {
  it('hai marker cùng một mốc không sinh ra đoạn rỗng', () => {
    const sections = markerSections(
      [
        { id: 'a', atUs: 5_000_000, label: '', color: 'blue' },
        { id: 'b', atUs: 5_000_000, label: '', color: 'red' }
      ],
      10_000_000
    )
    expect(sections.every((item) => item.endUs > item.startUs)).toBe(true)
    expect(sections).toHaveLength(1)
  })
})

describe('hardwareBitrate', () => {
  it('co giãn theo số điểm ảnh: 1080p cao là 16M, khung 540p nhỏ đi bốn lần', () => {
    expect(hardwareBitrate('high', 1920, 1080)).toBe('16M')
    expect(hardwareBitrate('high', 1080, 1920)).toBe('16M')
    expect(hardwareBitrate('high', 960, 540)).toBe('4M')
    expect(hardwareBitrate('compact', 320, 180)).toBe('1M')
  })
})
