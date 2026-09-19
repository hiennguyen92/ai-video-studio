import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import type { EditorCommand } from '../commands/editor-command-types'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import {
  expandToLinkGroups,
  isGroupedClip,
  planGroupClips,
  planMoveClips,
  planSplitClip,
  planUngroupClips
} from './clip-link-groups'

/**
 * Nhóm clip kiểm qua reducer THẬT: điều cần chứng minh là cả loạt dời mà không
 * clip nào đè mất một đoạn của clip anh em — chỉ nhìn danh sách lệnh thì không
 * thấy được chuyện đó.
 */

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

function apply(document: ProjectDocument, command: EditorCommand | null): void {
  if (!command) throw new Error('không có lệnh')
  const result = applyEditorCommand(document, command)
  if (!result.ok) throw new Error(result.error)
}

function spans(document: ProjectDocument, trackIndex: number): Array<[string, number, number]> {
  return document.tracks[trackIndex].clips.map((clip) => [clip.id, clip.startUs, clip.durationUs])
}

describe('clip/move-many', () => {
  it('dời hai clip liền nhau mà clip trước không đè mất clip sau', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    insert(document, 1, 'b', 2_000_000)

    apply(document, planMoveClips(document, ['a', 'b'], 1_000_000))

    // Dời từng cái bằng `clip/move` thì `a` rơi vào 1–3 s và cắt mất nửa đầu `b`.
    expect(spans(document, 1)).toEqual([
      ['a', 1_000_000, 2_000_000],
      ['b', 3_000_000, 2_000_000]
    ])
  })

  it('kẹp khoảng dời theo clip sớm nhất, giữ nguyên khoảng cách', () => {
    const document = project()
    insert(document, 1, 'a', 1_000_000)
    insert(document, 2, 'b', 5_000_000)

    apply(document, planMoveClips(document, ['a', 'b'], -3_000_000))

    expect(spans(document, 1)).toEqual([['a', 0, 2_000_000]])
    expect(spans(document, 2)).toEqual([['b', 4_000_000, 2_000_000]])
  })

  it('loạt clip trên nhiều track thì giữ track, bỏ qua track đích', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    insert(document, 2, 'b', 0)
    const command = planMoveClips(document, ['a', 'b'], 1_000_000, document.tracks[2].id)

    expect(command?.type === 'clip/move-many' && command.moves.every((m) => !m.toTrackId)).toBe(
      true
    )
  })

  it('một track bị khoá thì không dời clip nào', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    insert(document, 2, 'b', 0)
    document.tracks[2].locked = true

    const command = planMoveClips(document, ['a', 'b'], 1_000_000)
    expect(applyEditorCommand(document, command!).ok).toBe(false)
    expect(spans(document, 1)).toEqual([['a', 0, 2_000_000]])
  })

  it('không dời gì thì không sinh lệnh', () => {
    const document = project()
    insert(document, 1, 'a', 0)
    expect(planMoveClips(document, ['a'], -1_000_000)).toBeNull()
  })
})

describe('nhóm clip', () => {
  it('gộp rồi mở rộng vùng chọn ra cả nhóm', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    insert(document, 1, 'a', 0)
    insert(document, 2, 'm', 0)

    apply(document, planGroupClips(['v', 'a'], 'group_1'))

    expect(expandToLinkGroups(document, ['a'])).toEqual(['a', 'v'])
    expect(expandToLinkGroups(document, ['m'])).toEqual(['m'])
    expect(isGroupedClip(document, 'v')).toBe(true)
  })

  it('chưa đủ hai clip thì không gộp', () => {
    expect(planGroupClips(['a', 'a'], 'group_1')).toBeNull()
  })

  it('rã nhóm từ một thành viên là rã cả nhóm', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    insert(document, 1, 'a', 0)
    apply(document, planGroupClips(['v', 'a'], 'group_1'))

    apply(document, planUngroupClips(document, ['v']))

    expect(document.tracks.flatMap((track) => track.clips).every((clip) => !clip.linkGroupId)).toBe(
      true
    )
    expect(planUngroupClips(document, ['v'])).toBeNull()
  })

  it('thành viên còn lại một mình thì không tính là trong nhóm', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    insert(document, 1, 'a', 0)
    apply(document, planGroupClips(['v', 'a'], 'group_1'))
    apply(document, { type: 'clip/remove', clipId: 'a' })

    expect(isGroupedClip(document, 'v')).toBe(false)
  })

  it('từ chối id clip không tồn tại', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    const result = applyEditorCommand(document, {
      type: 'clip/set-link-group',
      clipIds: ['v', 'khong_co'],
      linkGroupId: 'group_1'
    })
    expect(result.ok).toBe(false)
  })
})

describe('cắt clip trong nhóm', () => {
  it('cắt cả nhóm: nửa đầu ở nhóm cũ, nửa sau thành nhóm MỚI — không phình thành ba clip', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    insert(document, 1, 'a', 0)
    apply(document, planGroupClips(['v', 'a'], 'g'))

    let next = 0
    const { commands, tailIds } = planSplitClip(document, 'v', 1_000_000, (prefix) =>
      prefix === 'group' ? 'g2' : `tail${(next += 1)}`
    )
    for (const command of commands) apply(document, command)

    expect(expandToLinkGroups(document, ['v']).sort()).toEqual(['a', 'v'])
    const tails = Object.values(tailIds)
    expect(tails).toHaveLength(2)
    expect(expandToLinkGroups(document, [tails[0]]).sort()).toEqual([...tails].sort())
  })

  it('lệnh cắt trơn không để nửa sau ở lại nhóm cũ', () => {
    const document = project()
    insert(document, 0, 'v', 0)
    insert(document, 1, 'a', 0)
    apply(document, planGroupClips(['v', 'a'], 'g'))
    apply(document, { type: 'clip/split', clipId: 'v', atUs: 1_000_000, newClipId: 'vt' })
    // Trước đây: nhóm của nửa sau là [vt, v, a] — xoá nửa hỏng xoá luôn cả nhóm.
    expect(expandToLinkGroups(document, ['vt'])).toEqual(['vt'])
  })
})
