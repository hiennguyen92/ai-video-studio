import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { canRedo, canUndo, createSessionState, redo, runCommands, undo } from './command-history'
import { parseEditorCommand } from './editor-command-types'

function projectWithAsset(): ProjectDocument {
  const doc = createEmptyProject({ name: 'Thử nghiệm' })
  const asset: MediaAsset = {
    id: 'asset_1',
    kind: 'video',
    name: 'canh-quay.mp4',
    source: { path: '/tmp/canh-quay.mp4', contentHash: 'hash', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 10_000_000, hasVideo: true, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: new Date().toISOString(),
    missing: false
  }
  doc.assets.push(asset)
  return doc
}

const videoTrackId = (doc: ProjectDocument): string =>
  doc.tracks.find((track) => track.kind === 'video')!.id

describe('giao dịch command', () => {
  it('tăng revision đúng một lần cho cả nhóm lệnh', () => {
    const doc = projectWithAsset()
    const state = createSessionState(doc)
    const trackId = videoTrackId(doc)

    const outcome = runCommands(
      state,
      [
        {
          type: 'clip/insert',
          trackId,
          assetId: 'asset_1',
          startUs: 0,
          durationUs: 2_000_000,
          sourceInUs: 0
        },
        {
          type: 'clip/insert',
          trackId,
          assetId: 'asset_1',
          startUs: 3_000_000,
          durationUs: 2_000_000,
          sourceInUs: 0
        },
        { type: 'project/rename', name: 'Đã đổi tên' }
      ],
      'Chèn hai clip'
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.state.document.revision).toBe(1)
    expect(outcome.state.past).toHaveLength(1)
    expect(outcome.state.document.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(2)
  })

  it('huỷ toàn bộ giao dịch khi một lệnh thất bại', () => {
    const doc = projectWithAsset()
    const state = createSessionState(doc)
    const trackId = videoTrackId(doc)

    const outcome = runCommands(
      state,
      [
        {
          type: 'clip/insert',
          trackId,
          assetId: 'asset_1',
          startUs: 0,
          durationUs: 2_000_000,
          sourceInUs: 0
        },
        { type: 'clip/remove', clipId: 'không-tồn-tại' }
      ],
      'Nhóm lệnh hỏng'
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failedIndex).toBe(1)
    // Document gốc không được đụng tới.
    expect(state.document.revision).toBe(0)
    expect(state.document.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(0)
  })

  it('hoàn tác cả nhóm nhiều lệnh trong một bước', () => {
    const doc = projectWithAsset()
    const trackId = videoTrackId(doc)
    let state = createSessionState(doc)

    const outcome = runCommands(
      state,
      [
        {
          type: 'clip/insert',
          trackId,
          assetId: 'asset_1',
          startUs: 0,
          durationUs: 2_000_000,
          sourceInUs: 0
        },
        {
          type: 'clip/insert',
          trackId,
          assetId: 'asset_1',
          startUs: 4_000_000,
          durationUs: 2_000_000,
          sourceInUs: 0
        }
      ],
      'Thay đổi do AI'
    )
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    state = outcome.state

    expect(canUndo(state)).toBe(true)
    state = undo(state)
    expect(state.document.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(0)
    expect(state.document.revision).toBe(0)

    expect(canRedo(state)).toBe(true)
    state = redo(state)
    expect(state.document.tracks.find((t) => t.id === trackId)!.clips).toHaveLength(2)
    expect(state.document.revision).toBe(1)
  })

  it('ghi đè clip cũ khi chèn chồng lên', () => {
    const doc = projectWithAsset()
    const trackId = videoTrackId(doc)
    let state = createSessionState(doc)

    state = (
      runCommands(
        state,
        [
          {
            type: 'clip/insert',
            clipId: 'c1',
            trackId,
            assetId: 'asset_1',
            startUs: 0,
            durationUs: 4_000_000,
            sourceInUs: 0
          }
        ],
        'clip đầu'
      ) as { ok: true; state: typeof state }
    ).state

    state = (
      runCommands(
        state,
        [
          {
            type: 'clip/insert',
            clipId: 'c2',
            trackId,
            assetId: 'asset_1',
            startUs: 2_000_000,
            durationUs: 2_000_000,
            sourceInUs: 0
          }
        ],
        'clip đè lên'
      ) as { ok: true; state: typeof state }
    ).state

    const clips = state.document.tracks.find((t) => t.id === trackId)!.clips
    expect(clips).toHaveLength(2)
    expect(clips[0]).toMatchObject({ id: 'c1', startUs: 0, durationUs: 2_000_000 })
    expect(clips[1]).toMatchObject({ id: 'c2', startUs: 2_000_000 })
  })
})

describe('kiểm tra payload lệnh', () => {
  it('nhận lệnh hợp lệ', () => {
    const result = parseEditorCommand({
      type: 'clip/insert',
      trackId: 't1',
      assetId: 'a1',
      startUs: 0,
      durationUs: 1000
    })
    expect(result.ok).toBe(true)
  })

  it('từ chối thời lượng âm — AI không thể ghi dữ liệu vô nghĩa', () => {
    const result = parseEditorCommand({
      type: 'clip/insert',
      trackId: 't1',
      assetId: 'a1',
      startUs: 0,
      durationUs: -5
    })
    expect(result.ok).toBe(false)
  })

  it('từ chối loại lệnh không tồn tại', () => {
    expect(parseEditorCommand({ type: 'project/delete-everything' }).ok).toBe(false)
  })
})
