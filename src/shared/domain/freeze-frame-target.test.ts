import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { freezeFrameSourceAt, pickFreezeFrameClipId } from './freeze-frame-target'
import type { MediaAsset } from './media-asset-types'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'

function asset(id: string, kind: MediaAsset['kind']): MediaAsset {
  return {
    id,
    kind,
    name: id,
    source: { path: `/tmp/${id}`, contentHash: id, sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: kind !== 'audio', hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

/** Hình 0–4 s (nguồn từ 1 s) nhóm với tiếng 0–4 s. */
function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push(asset('cam', 'video'), asset('mic', 'audio'))
  for (const [trackIndex, clipId, assetId] of [
    [0, 'hinh', 'cam'],
    [1, 'tieng', 'mic']
  ] as const) {
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[trackIndex].id,
      assetId,
      startUs: 0,
      durationUs: 4_000_000,
      sourceInUs: 1_000_000
    })
  }
  applyEditorCommand(document, {
    type: 'clip/set-link-group',
    clipIds: ['hinh', 'tieng'],
    linkGroupId: 'g'
  })
  return document
}

describe('pickFreezeFrameClipId', () => {
  it('bấm clip tiếng trong nhóm: lấy clip hình của nhóm dưới đầu phát', () => {
    expect(pickFreezeFrameClipId(project(), ['tieng', 'hinh'], 2_000_000)).toBe('hinh')
  })

  it('không thành viên nào dùng được: giữ clip đã bấm để báo lỗi rõ', () => {
    expect(pickFreezeFrameClipId(project(), ['tieng', 'hinh'], 9_000_000)).toBe('tieng')
  })
})

describe('freezeFrameSourceAt', () => {
  it('clip bị dời trong lúc chờ: khung chèn theo vị trí MỚI, vẫn đúng khung nguồn', () => {
    const document = project()
    // Khung nguồn 3 s = giây 2 trên timeline lúc bấm.
    applyEditorCommand(document, {
      type: 'clip/move',
      clipId: 'hinh',
      toTrackId: document.tracks[0].id,
      toStartUs: 5_000_000
    })
    const source = freezeFrameSourceAt(document, 'hinh', 3_000_000)
    expect(source.atUs).toBe(7_000_000)
    expect(source.sourceUs).toBe(3_000_000)
  })

  it('khung đã bị cắt khỏi clip: báo lỗi, không chèn nhầm chỗ', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'clip/trim',
      clipId: 'hinh',
      edge: 'end',
      toUs: 1_000_000
    })
    expect(() => freezeFrameSourceAt(document, 'hinh', 3_000_000)).toThrow(/không còn nằm/)
  })
})
