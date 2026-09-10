import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from './editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { clipSourceOutUs, type Clip } from '../domain/timeline-track-types'

/**
 * Đổi tốc độ phát của clip.
 *
 * Điều quan trọng nhất phải chứng minh: đổi tốc độ GIỮ NGUYÊN khoảng nguồn và chỉ
 * đổi độ dài trên timeline. Làm ngược lại — giữ độ dài, đổi khoảng nguồn — thì
 * tăng tốc sẽ đòi nhiều phim hơn số phim đang có, và bất biến
 * `sourceInUs + durationUs * speed <= thời lượng asset` vỡ ngay.
 */

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'a.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 10_000_000, hasVideo: true, hasAudio: true },
    createdAt: new Date().toISOString()
  })
  return document
}

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 4_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...overrides
  }
}

function withClip(
  kind: 'video' | 'audio' | 'image' = 'video',
  extra: Partial<Clip> = {}
): ProjectDocument {
  const document = project()
  document.tracks.push({
    id: 'track_1',
    kind,
    name: 'T',
    clips: [clip(extra)],
    volume: 1,
    muted: false,
    hidden: false,
    locked: false,
    heightPx: 80
  })
  return document
}

/** Dự án mới đã có sẵn vài track mặc định, nên phải tìm theo id chứ không lấy [0]. */
const track = (document: ProjectDocument): ProjectDocument['tracks'][number] =>
  document.tracks.find((item) => item.id === 'track_1')!
const firstClip = (document: ProjectDocument): Clip => track(document).clips[0]

describe('đổi tốc độ clip', () => {
  it('tăng tốc làm clip ngắn lại nhưng vẫn đúng đoạn phim đó', () => {
    const document = withClip()
    const before = clipSourceOutUs(firstClip(document))

    expect(
      applyEditorCommand(document, { type: 'clip/set-speed', clipId: 'clip_1', speed: 2 }).ok
    ).toBe(true)

    expect(firstClip(document).speed).toBe(2)
    expect(firstClip(document).durationUs).toBe(2_000_000)
    // Khoảng nguồn KHÔNG đổi — đó là cả điểm của cách làm này.
    expect(clipSourceOutUs(firstClip(document))).toBe(before)
  })

  it('chậm lại làm clip dài ra, khoảng nguồn vẫn nguyên', () => {
    const document = withClip()
    const before = clipSourceOutUs(firstClip(document))

    applyEditorCommand(document, { type: 'clip/set-speed', clipId: 'clip_1', speed: 0.5 })

    expect(firstClip(document).durationUs).toBe(8_000_000)
    expect(clipSourceOutUs(firstClip(document))).toBe(before)
  })

  it('tăng tốc không bao giờ đòi nhiều phim hơn số đang có', () => {
    // Clip đã ăn tới sát cuối asset. Nếu giữ độ dài và đổi khoảng nguồn thì tốc độ
    // 4× sẽ đòi 16 giây phim trong khi asset chỉ có 10 — hỏng âm thầm.
    const document = withClip('video', { sourceInUs: 6_000_000, durationUs: 4_000_000 })

    applyEditorCommand(document, { type: 'clip/set-speed', clipId: 'clip_1', speed: 4 })

    const asset = document.assets[0].probe!.durationUs
    expect(clipSourceOutUs(firstClip(document))).toBeLessThanOrEqual(asset)
  })

  it('clip dài ra thì lấn clip bên cạnh, đúng như kéo mép vẫn làm', () => {
    const document = withClip()
    track(document).clips.push(clip({ id: 'clip_2', startUs: 4_000_000, sourceInUs: 4_000_000 }))

    applyEditorCommand(document, { type: 'clip/set-speed', clipId: 'clip_1', speed: 0.5 })

    // Chính sách ghi đè có sẵn của timeline: clip vừa đổi thắng, clip bên cạnh bị
    // gọt. Không có clip nào chồng lấn sau đó.
    const clips = track(document).clips
    for (let i = 1; i < clips.length; i++) {
      expect(clips[i].startUs).toBeGreaterThanOrEqual(
        clips[i - 1].startUs + clips[i - 1].durationUs
      )
    }
  })

  it('từ chối clip trên lane ảnh', () => {
    // Ảnh tĩnh không có trục thời gian riêng nên "phát nhanh gấp đôi" vô nghĩa.
    const document = withClip('image')
    const result = applyEditorCommand(document, {
      type: 'clip/set-speed',
      clipId: 'clip_1',
      speed: 2
    })

    expect(result.ok).toBe(false)
    expect(firstClip(document).speed).toBe(1)
  })

  it('từ chối track đang khoá', () => {
    const document = withClip()
    track(document).locked = true

    expect(
      applyEditorCommand(document, { type: 'clip/set-speed', clipId: 'clip_1', speed: 2 }).ok
    ).toBe(false)
  })
})
