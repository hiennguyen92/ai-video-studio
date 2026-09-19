import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { buildProjectContext } from './chat-context-builder'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

let counter = 0
const makeId = (prefix = 'clip'): string => `${prefix}_${(counter += 1)}`

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
  for (const [index, clipId] of [
    [0, 'v'],
    [1, 'a']
  ] as const) {
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[index].id,
      assetId: 'asset_1',
      startUs: 1_000_000,
      durationUs: 2_000_000,
      sourceInUs: 0
    })
  }
  return document
}

function run(
  document: ProjectDocument,
  calls: Array<{ name: string; arguments: unknown }>,
  selected: string[] = []
): void {
  const context: ChatEditContext = { document, selectedClipIds: selected, playheadUs: 0, makeId }
  const plan = planChatToolCalls(context, calls)
  expect(plan.failures).toEqual([])
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    expect(applyEditorCommand(document, command).ok).toBe(true)
  }
}

const startOf = (document: ProjectDocument, id: string): number | undefined =>
  document.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id)?.startUs

describe('công cụ nhóm clip', () => {
  it('group_clips lấy vùng chọn khi không nêu id, và tổng quan in ra nhóm', () => {
    const document = project()
    run(document, [{ name: 'group_clips', arguments: {} }], ['v', 'a'])
    expect(buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })).toMatch(
      /group=group_/
    )
  })

  it('move_clip dời cả nhóm cùng một khoảng', () => {
    const document = project()
    run(document, [{ name: 'group_clips', arguments: { clipIds: ['v', 'a'] } }])
    run(document, [{ name: 'move_clip', arguments: { clipId: 'a', toSeconds: 4 } }])
    expect(startOf(document, 'a')).toBe(4_000_000)
    expect(startOf(document, 'v')).toBe(4_000_000)
  })

  it('ungroup_clips xong thì move_clip chỉ dời một clip', () => {
    const document = project()
    run(document, [{ name: 'group_clips', arguments: { clipIds: ['v', 'a'] } }])
    run(document, [{ name: 'ungroup_clips', arguments: { clipId: 'v' } }])
    run(document, [{ name: 'move_clip', arguments: { clipId: 'a', toSeconds: 4 } }])
    expect(startOf(document, 'v')).toBe(1_000_000)
  })

  it('từ chối gộp một clip lẻ', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: ['v'], playheadUs: 0, makeId }, [
      { name: 'group_clips', arguments: {} }
    ])
    expect(plan.failures).toHaveLength(1)
  })
})
