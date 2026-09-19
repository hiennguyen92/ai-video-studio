import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from './editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { planRippleDeleteClips } from './clip-ripple-delete'

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
  return document
}

function insert(
  document: ProjectDocument,
  trackIndex: number,
  clipId: string,
  startUs: number
): void {
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId: document.tracks[trackIndex].id,
    assetId: 'asset_1',
    startUs,
    durationUs: 2_000_000,
    sourceInUs: 0
  })
  if (!result.ok) throw new Error(result.error)
}

function runAll(document: ProjectDocument, clipIds: string[]): void {
  for (const command of planRippleDeleteClips(document, clipIds) ?? []) {
    const result = applyEditorCommand(document, command)
    if (!result.ok) throw new Error(result.error)
  }
}

const starts = (document: ProjectDocument, trackIndex: number): Array<[string, number]> =>
  document.tracks[trackIndex].clips.map((clip) => [clip.id, clip.startUs])

describe('planRippleDeleteClips', () => {
  it('xoá clip và kéo clip sau trên cùng track lùi lên; track khác đứng yên', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    insert(document, 1, 'b', 2_000_000)
    insert(document, 1, 'c', 5_000_000)
    insert(document, 2, 'nhac', 3_000_000)

    runAll(document, ['b'])

    expect(starts(document, 1)).toEqual([
      ['a', 0],
      ['c', 3_000_000]
    ])
    expect(starts(document, 2)).toEqual([['nhac', 3_000_000]])
  })

  it('nhiều clip trên cùng track: xử lý từ clip muộn nhất nên toạ độ không lệch', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    insert(document, 1, 'b', 2_000_000)
    insert(document, 1, 'c', 4_000_000)
    insert(document, 1, 'd', 6_000_000)

    runAll(document, ['a', 'c'])

    expect(starts(document, 1)).toEqual([
      ['b', 0],
      ['d', 2_000_000]
    ])
  })

  it('không có clip nào khớp thì không sinh lệnh', () => {
    expect(planRippleDeleteClips(project(), ['khong_co'])).toBeNull()
  })
})
