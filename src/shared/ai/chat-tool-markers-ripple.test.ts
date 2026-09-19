import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { buildProjectContext } from './chat-context-builder'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

let counter = 0
const makeId = (prefix = 'clip'): string => `${prefix}_${(counter += 1)}`

function run(
  document: ProjectDocument,
  name: string,
  args: unknown,
  selected: string[] = []
): string[] {
  const context: ChatEditContext = { document, selectedClipIds: selected, playheadUs: 0, makeId }
  const plan = planChatToolCalls(context, [{ name, arguments: args }])
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    expect(applyEditorCommand(document, command).ok).toBe(true)
  }
  return plan.failures.map((failure) => failure.reason)
}

describe('công cụ marker', () => {
  it('đặt, sửa, xoá marker; tổng quan liệt kê marker', () => {
    const document = createEmptyProject({ name: 'Thử' })
    expect(run(document, 'add_marker', { atSeconds: 12.5, label: 'Hook', color: 'red' })).toEqual(
      []
    )
    const id = document.markers[0].id
    expect(buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })).toContain(
      `id=${id} at=12.50s color=red label="Hook"`
    )

    run(document, 'update_marker', { markerId: id, label: 'Mở bài' })
    expect(document.markers[0]).toMatchObject({ label: 'Mở bài', color: 'red', atUs: 12_500_000 })

    run(document, 'remove_marker', { markerId: id })
    expect(document.markers).toEqual([])
  })

  it('marker bịa ra bị chặn, kèm danh sách marker có thật', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const errors = run(document, 'remove_marker', { markerId: 'khong_co' })
    expect(errors[0]).toMatch(/chưa có marker nào/)
  })
})

describe('công cụ ripple_delete_clip', () => {
  it('xoá clip đang chọn và dồn clip sau lên', () => {
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
    for (const [clipId, startUs] of [
      ['a', 0],
      ['b', 2_000_000]
    ] as const) {
      applyEditorCommand(document, {
        type: 'clip/insert',
        clipId,
        trackId: document.tracks[1].id,
        assetId: 'asset_1',
        startUs,
        durationUs: 2_000_000,
        sourceInUs: 0
      })
    }

    expect(run(document, 'ripple_delete_clip', {}, ['a'])).toEqual([])
    expect(document.tracks[1].clips.map((clip) => [clip.id, clip.startUs])).toEqual([['b', 0]])
  })
})
