import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../../../shared/domain/project-document-factory'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { collectGroupDragClips, groupDragPreview } from './clip-group-drag'

function clip(id: string, startUs: number): Clip {
  return { id, startUs, durationUs: 1_000_000 } as Clip
}

describe('groupDragPreview', () => {
  it('mọi clip dời đúng khoảng của clip đang cầm', () => {
    const members = [{ clip: clip('b', 3_000_000) }, { clip: clip('a', 1_000_000) }]
    const { deltaUs, group } = groupDragPreview(members, members[0].clip, 5_000_000)
    expect(deltaUs).toBe(2_000_000)
    expect(group.map((item) => item.startUs)).toEqual([5_000_000, 3_000_000])
  })

  it('kéo về trước thì dừng khi clip SỚM NHẤT chạm 0', () => {
    const members = [{ clip: clip('b', 3_000_000) }, { clip: clip('a', 1_000_000) }]
    const { group } = groupDragPreview(members, members[0].clip, 0)
    expect(group.map((item) => item.startUs)).toEqual([2_000_000, 0])
  })
})

describe('collectGroupDragClips', () => {
  it('đưa clip đang cầm lên đầu', () => {
    const document = createEmptyProject({ name: 'Thử' })
    document.tracks[1].clips = [clip('a', 0)]
    document.tracks[2].clips = [clip('b', 0)]
    expect(collectGroupDragClips(document, ['a', 'b'], 'b').map((item) => item.clip.id)).toEqual([
      'b',
      'a'
    ])
  })
})
