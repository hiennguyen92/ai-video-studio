import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { planChatToolCalls } from '../ai/chat-tool-planner'
import { planFreezeFrame, resolveFreezeFrameSource } from './freeze-frame-planner'
import type { MediaAsset } from './media-asset-types'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'

let counter = 0
const makeId = (prefix: string): string => `${prefix}_${(counter += 1)}`

function asset(id: string, kind: MediaAsset['kind']): MediaAsset {
  return {
    id,
    kind,
    name: id,
    source: { path: `/tmp/${id}`, contentHash: id, sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: kind !== 'audio', hasAudio: kind !== 'image' },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push(asset('cam', 'video'), asset('nhac', 'audio'))
  const insert = (trackIndex: number, clipId: string, assetId: string, startUs: number): void => {
    const result = applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[trackIndex].id,
      assetId,
      startUs,
      durationUs: 4_000_000,
      sourceInUs: 1_000_000
    })
    if (!result.ok) throw new Error(result.error)
  }
  insert(0, 'hinh', 'cam', 0)
  insert(0, 'hinh-sau', 'cam', 4_000_000)
  insert(1, 'tieng', 'nhac', 0)
  insert(2, 'nen', 'nhac', 0)
  applyEditorCommand(document, {
    type: 'clip/set-link-group',
    clipIds: ['hinh', 'tieng'],
    linkGroupId: 'g'
  })
  return document
}

const freeze = {
  ...asset('dung', 'video'),
  probe: { durationUs: 10_000_000, hasVideo: true, hasAudio: false }
}

const spans = (document: ProjectDocument, trackIndex: number): Array<[string, number, number]> =>
  document.tracks[trackIndex].clips.map((clip) => [clip.assetId, clip.startUs, clip.durationUs])

describe('resolveFreezeFrameSource', () => {
  it('quy đầu phát ra mốc NGUỒN, tính cả điểm vào và tốc độ', () => {
    const document = project()
    applyEditorCommand(document, { type: 'clip/update', clipId: 'hinh', patch: { speed: 2 } })
    const source = resolveFreezeFrameSource(document, 'hinh', 1_000_000)
    // Nguồn bắt đầu ở 1 s, phát nhanh gấp đôi: 1 s trên timeline = 2 s nguồn.
    expect(source.sourceUs).toBe(3_000_000)
  })

  it('từ chối đầu phát nằm ngoài clip, và clip ảnh tĩnh', () => {
    const document = project()
    expect(() => resolveFreezeFrameSource(document, 'hinh', 9_000_000)).toThrow(/nằm trong clip/)
    expect(() => resolveFreezeFrameSource(document, 'nen', 1_000_000)).toThrow(/lane hình/)
  })
})

describe('công cụ freeze_frame', () => {
  it('dùng khung đã dựng sẵn, chèn tại atSeconds với độ dài yêu cầu', () => {
    const document = project()
    const plan = planChatToolCalls(
      {
        document,
        selectedClipIds: ['hinh'],
        playheadUs: 0,
        makeId,
        freezeFrames: { hinh: { asset: freeze } }
      },
      [{ name: 'freeze_frame', arguments: { atSeconds: 2, durationSeconds: 1.5 } }]
    )
    expect(plan.failures).toEqual([])
    for (const command of plan.steps[0].commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[0].clips[1]).toMatchObject({
      assetId: 'dung',
      startUs: 2_000_000,
      durationUs: 1_500_000
    })
  })

  it('chưa dựng được khung thì từ chối, không phát lệnh', () => {
    const plan = planChatToolCalls(
      { document: project(), selectedClipIds: ['hinh'], playheadUs: 1_000_000, makeId },
      [{ name: 'freeze_frame', arguments: {} }]
    )
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('planFreezeFrame', () => {
  it('tách clip và nhóm tại mốc, dời phần sau trên các lane đó, chèn đoạn đứng hình', () => {
    const document = project()
    const source = resolveFreezeFrameSource(document, 'hinh', 1_500_000)
    for (const command of planFreezeFrame(document, source, freeze, 2_000_000, makeId)) {
      const result = applyEditorCommand(document, command)
      expect(result.ok).toBe(true)
    }

    expect(spans(document, 0)).toEqual([
      ['cam', 0, 1_500_000],
      ['dung', 1_500_000, 2_000_000],
      ['cam', 3_500_000, 2_500_000],
      ['cam', 6_000_000, 4_000_000]
    ])
    // Tiếng cùng nhóm tách và dời theo, để khẩu hình vẫn khớp sau đoạn đứng hình.
    expect(spans(document, 1)).toEqual([
      ['nhac', 0, 1_500_000],
      ['nhac', 3_500_000, 2_500_000]
    ])
    // Nhạc nền không thuộc nhóm: đứng yên.
    expect(spans(document, 2)).toEqual([['nhac', 0, 4_000_000]])

    const still = document.tracks[0].clips[1]
    expect(still).toMatchObject({ volume: 0, sourceInUs: 0, linkGroupId: 'g' })
  })
})
