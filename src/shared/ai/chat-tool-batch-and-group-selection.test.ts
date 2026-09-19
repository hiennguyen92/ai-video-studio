import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

/**
 * Hai lỗi agent tìm ra khi soát:
 *
 * 1. Mọi lời gọi trong MỘT câu trả lời được lập trên cùng bản chụp ban đầu —
 *    "ripple xoá a" rồi "ripple xoá c" xoá nhầm d.
 * 2. Bấm clip trong nhóm là chọn cả nhóm, và mọi công cụ một-clip từ chối vì
 *    "đang chọn nhiều clip".
 */

let counter = 0
const makeId = (prefix = 'clip'): string => `${prefix}_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'mic',
    kind: 'audio',
    name: 'mic.wav',
    source: { path: '/tmp/mic.wav', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  for (const [index, clipId] of ['a', 'b', 'c', 'd'].entries()) {
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[1].id,
      assetId: 'mic',
      startUs: index * 2_000_000,
      durationUs: 2_000_000,
      sourceInUs: 0
    })
  }
  return document
}

function applyAll(document: ProjectDocument, plan: ReturnType<typeof planChatToolCalls>): void {
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    const result = applyEditorCommand(document, command)
    if (!result.ok) throw new Error(result.error)
  }
}

const ids = (document: ProjectDocument): string[] => document.tracks[1].clips.map((clip) => clip.id)

describe('nhiều lời gọi trong một câu trả lời', () => {
  it('ripple xoá a rồi c: xoá đúng a và c, b và d còn lại liền nhau', () => {
    const document = project()
    const plan = planChatToolCalls(
      { document, selectedClipIds: [], playheadUs: 0, makeId } satisfies ChatEditContext,
      [
        { name: 'ripple_delete_clip', arguments: { clipId: 'a' } },
        { name: 'ripple_delete_clip', arguments: { clipId: 'c' } }
      ]
    )
    expect(plan.failures).toEqual([])
    applyAll(document, plan)
    // Trước đây: d bị xoá, c còn nguyên.
    expect(ids(document)).toEqual(['b', 'd'])
    expect(document.tracks[1].clips.map((clip) => clip.startUs)).toEqual([0, 2_000_000])
  })

  it('bước không áp được thì bỏ hẳn, bước sau không lập trên nó', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      { name: 'remove_clip', arguments: { clipId: 'b' } },
      { name: 'remove_clip', arguments: { clipId: 'b' } }
    ])
    expect(plan.steps).toHaveLength(1)
    expect(plan.failures).toHaveLength(1)
  })
})

describe('chọn cả một nhóm vẫn là "một clip"', () => {
  function grouped(): ProjectDocument {
    const document = project()
    applyEditorCommand(document, {
      type: 'clip/set-link-group',
      clipIds: ['a', 'b'],
      linkGroupId: 'g'
    })
    return document
  }

  it('ungroup_clips không nêu id: rã được nhóm đang chọn', () => {
    const document = grouped()
    const plan = planChatToolCalls(
      { document, selectedClipIds: ['a', 'b'], playheadUs: 0, makeId },
      [{ name: 'ungroup_clips', arguments: {} }]
    )
    expect(plan.failures).toEqual([])
    applyAll(document, plan)
    expect(document.tracks[1].clips.every((clip) => !clip.linkGroupId)).toBe(true)
  })

  it('công cụ một-clip lấy đúng clip người dùng bấm (đứng đầu vùng chọn)', () => {
    const document = grouped()
    const plan = planChatToolCalls(
      { document, selectedClipIds: ['b', 'a'], playheadUs: 0, makeId },
      [{ name: 'set_clip_volume', arguments: { volume: 0.5 } }]
    )
    applyAll(document, plan)
    expect(document.tracks[1].clips.find((clip) => clip.id === 'b')!.volume).toBe(0.5)
    expect(document.tracks[1].clips.find((clip) => clip.id === 'a')!.volume).toBe(1)
  })

  it('chọn lẫn hai clip RỜI thì vẫn từ chối, không đoán', () => {
    const document = grouped()
    const plan = planChatToolCalls(
      { document, selectedClipIds: ['a', 'c'], playheadUs: 0, makeId },
      [{ name: 'set_clip_volume', arguments: { volume: 0.5 } }]
    )
    expect(plan.failures[0].reason).toMatch(/nhiều clip/)
  })
})
