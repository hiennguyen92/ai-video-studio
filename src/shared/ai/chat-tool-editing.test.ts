import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { clipEndUs } from '../domain/timeline-track-types'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

/**
 * Công cụ dựng phim cho agent.
 *
 * Trọng tâm: `build_cut_from_transcript` — một lượt gọi ra cả bản dựng. Điều phải
 * chứng minh là bản dựng đó **chạy được qua reducer thật** và các clip nằm sát
 * nhau đúng thứ tự lời nói, vì đó là thứ quyết định video có mạch hay không.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'canh-quay.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  document.transcripts.push({
    id: 'tr_1',
    assetId: 'asset_1',
    language: 'vi',
    languageAutoDetected: false,
    providerId: 'whisper-cpp',
    model: 'ggml',
    createdAt: '2026-01-01T00:00:00.000Z',
    segments: [
      { id: 's1', startUs: 1_000_000, endUs: 3_000_000, text: 'Câu một', edited: false },
      { id: 's2', startUs: 5_000_000, endUs: 6_000_000, text: 'Câu hai', edited: false },
      { id: 's3', startUs: 9_000_000, endUs: 12_000_000, text: 'Câu ba', edited: false }
    ]
  })
  return document
}

function context(document: ProjectDocument): ChatEditContext {
  return { document, selectedClipIds: [], playheadUs: 0, makeId }
}

function applyAll(
  document: ProjectDocument,
  calls: Array<{ name: string; arguments: unknown }>
): ReturnType<typeof planChatToolCalls> {
  const plan = planChatToolCalls(context(document), calls)
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    const result = applyEditorCommand(document, command)
    expect(result.ok).toBe(true)
  }
  return plan
}

describe('build_cut_from_transcript', () => {
  it('xếp các đoạn được giữ sát nhau, không để khe hở', () => {
    const document = project()
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1', 's3'] } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips).toHaveLength(2)
    // Đoạn 1 dài 2s, đoạn 3 dài 3s → nối liền thành 0–2s và 2–5s.
    expect(clips.map((clip) => [clip.startUs, clipEndUs(clip)])).toEqual([
      [0, 2_000_000],
      [2_000_000, 5_000_000]
    ])
  })

  it('mỗi clip đọc đúng đoạn nguồn tương ứng', () => {
    const document = project()
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1', 's3'] } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips.map((clip) => clip.sourceInUs)).toEqual([1_000_000, 9_000_000])
  })

  it('giữ THỨ TỰ TRANSCRIPT dù mô hình liệt kê id lộn xộn', () => {
    const document = project()
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s3', 's1', 's2'] } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    // Lời phải chạy đúng mạch s1 → s2 → s3, không theo thứ tự mô hình đưa ra.
    expect(clips.map((clip) => clip.sourceInUs)).toEqual([1_000_000, 5_000_000, 9_000_000])
  })

  it('dựng lại lần hai thay hẳn bản cũ, không chồng lên', () => {
    const document = project()
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1', 's2', 's3'] } }
    ])
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s2'] } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips).toHaveLength(1)
    expect(clips[0].sourceInUs).toBe(5_000_000)
  })

  it('từ chối id đoạn mô hình bịa ra thay vì lặng lẽ bỏ qua', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1', 's_khong_co'] } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures[0].reason).toContain('Không tìm thấy đoạn')
  })

  it('báo lỗi khi chưa có bản phiên âm', () => {
    const document = createEmptyProject({ name: 'Rỗng' })
    const plan = planChatToolCalls(context(document), [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1'] } }
    ])
    expect(plan.failures[0].reason).toContain('chưa có bản phiên âm')
  })
})

describe('insert_clip', () => {
  it('chèn được media vào track hợp kiểu mà không cần nêu track', () => {
    const document = project()
    applyAll(document, [
      { name: 'insert_clip', arguments: { assetId: 'asset_1', startSeconds: 2 } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips).toHaveLength(1)
    expect(clips[0].startUs).toBe(2_000_000)
    // Bỏ trống thời lượng thì lấy hết phần còn lại của nguồn.
    expect(clips[0].durationUs).toBe(60_000_000)
  })

  it('kẹp thời lượng lại thay vì tạo clip đọc quá cuối file', () => {
    const document = project()
    applyAll(document, [
      {
        name: 'insert_clip',
        arguments: { assetId: 'asset_1', startSeconds: 0, sourceInSeconds: 55, durationSeconds: 30 }
      }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips[0].durationUs).toBe(5_000_000)
  })

  it('từ chối điểm vào nằm ngoài file', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      {
        name: 'insert_clip',
        arguments: { assetId: 'asset_1', startSeconds: 0, sourceInSeconds: 90 }
      }
    ])
    expect(plan.failures[0].reason).toContain('nằm ngoài')
  })

  it('từ chối media không tồn tại', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'insert_clip', arguments: { assetId: 'khong_co', startSeconds: 0 } }
    ])
    expect(plan.failures[0].reason).toContain('Không tìm thấy media')
  })
})

describe('ripple_delete_range', () => {
  it('cắt bỏ khoảng giữa và dồn phần sau lên', () => {
    const document = project()
    applyAll(document, [
      { name: 'build_cut_from_transcript', arguments: { keepSegmentIds: ['s1', 's2', 's3'] } }
    ])
    // Bản cut: 0–2s, 2–3s, 3–6s. Cắt bỏ 2–3s.
    applyAll(document, [
      { name: 'ripple_delete_range', arguments: { fromSeconds: 2, toSeconds: 3 } }
    ])

    const clips = document.tracks.find((track) => track.kind === 'video')?.clips ?? []
    expect(clips.map((clip) => [clip.startUs, clipEndUs(clip)])).toEqual([
      [0, 2_000_000],
      [2_000_000, 5_000_000]
    ])
  })

  it('từ chối khoảng ngược hoặc rỗng', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'ripple_delete_range', arguments: { fromSeconds: 5, toSeconds: 5 } }
    ])
    expect(plan.failures[0].reason).toContain('phải sau')
  })
})

describe('add_track', () => {
  it('thêm được track mới kèm vai trò', () => {
    const document = project()
    const before = document.tracks.length
    applyAll(document, [
      { name: 'add_track', arguments: { kind: 'audio', name: 'Nhạc 2', role: 'music' } }
    ])

    expect(document.tracks).toHaveLength(before + 1)
    expect(document.tracks.at(-1)?.role).toBe('music')
  })
})
