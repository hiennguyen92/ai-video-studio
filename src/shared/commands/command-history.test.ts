import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'
import {
  canRedo,
  canUndo,
  createSessionState,
  redo,
  runCommands,
  runCommandsSilently,
  undo
} from './command-history'
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

describe('ghi lặng lẽ (dữ liệu phái sinh tới sau)', () => {
  /** Nhập xong → filmstrip dựng xong vài giây sau; cái vá đó không được đụng lịch sử. */
  it('không thêm bước hoàn tác và KHÔNG xoá nhánh redo đang có', () => {
    const doc = projectWithAsset()
    let state = createSessionState(doc)

    const inserted = runCommands(
      state,
      [
        {
          type: 'clip/insert',
          trackId: videoTrackId(doc),
          assetId: 'asset_1',
          startUs: 0,
          durationUs: 2_000_000,
          sourceInUs: 0
        }
      ],
      'Chèn clip'
    )
    expect(inserted.ok).toBe(true)
    if (!inserted.ok) return
    state = undo(inserted.state)
    expect(canRedo(state)).toBe(true)

    const pastBefore = state.past
    const futureBefore = state.future

    const outcome = runCommandsSilently(state, [
      {
        type: 'asset/set-derived',
        assetId: 'asset_1',
        derived: { filmstripPath: '/cache/asset_1-strip.jpg', filmstripFrameCount: 40 }
      }
    ])

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.state.past).toBe(pastBefore)
    // Nhánh redo còn nguyên: người dùng vừa Ctrl+Z, Ctrl+Shift+Z vẫn phải làm lại được.
    expect(outcome.state.future).toBe(futureBefore)
    expect(canRedo(outcome.state)).toBe(true)
    expect(outcome.state.document.assets[0].derived.filmstripPath).toBe('/cache/asset_1-strip.jpg')
    expect(outcome.state.document.revision).toBe(state.document.revision + 1)
  })

  it('bỏ qua asset đã bị xoá trong lúc ffmpeg chạy, không báo lỗi', () => {
    const state = createSessionState(projectWithAsset())

    const outcome = runCommandsSilently(state, [
      { type: 'asset/set-derived', assetId: 'asset_khong_ton_tai', derived: { waveformPath: '/x' } }
    ])

    expect(outcome.ok).toBe(true)
  })

  it('giữ nguyên dữ liệu phái sinh cũ khi chỉ vá một trường', () => {
    const doc = projectWithAsset()
    doc.assets[0].derived.thumbnailPath = '/cache/asset_1.jpg'
    const state = createSessionState(doc)

    const outcome = runCommandsSilently(state, [
      { type: 'asset/set-derived', assetId: 'asset_1', derived: { waveformPath: '/cache/p.bin' } }
    ])

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.state.document.assets[0].derived).toEqual({
      thumbnailPath: '/cache/asset_1.jpg',
      waveformPath: '/cache/p.bin'
    })
  })
})
