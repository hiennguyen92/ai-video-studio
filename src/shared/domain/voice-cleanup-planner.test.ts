import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import type { MediaAsset } from './media-asset-types'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import type { Clip, Track } from './timeline-track-types'
import { planVoiceCleanup, resolveVoiceCleanupTarget } from './voice-cleanup-planner'

/** Đi qua reducer THẬT: dán, tắt tiếng, gộp nhóm phải cùng chạy được trong một lượt. */

let counter = 0
const makeId = (prefix: string): string => `${prefix}_${(counter += 1)}`

function asset(id: string, kind: MediaAsset['kind'], extra: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id,
    kind,
    name: `${id}.bin`,
    source: { path: `/tmp/${id}`, contentHash: id, sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: kind === 'video', hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false,
    ...extra
  }
}

const cleanedOf = (sourceId: string, id = `clean_${sourceId}`): MediaAsset =>
  asset(id, 'audio', {
    origin: 'generated',
    generated: {
      task: 'voice-cleanup',
      providerId: 'ffmpeg',
      model: 'x',
      jobId: 'j',
      requestFingerprint: id,
      sourceAssetId: sourceId
    }
  })

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push(asset('cam', 'video'), asset('mic', 'audio'))
  return document
}

function insert(
  document: ProjectDocument,
  trackIndex: number,
  clipId: string,
  assetId: string
): void {
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId: document.tracks[trackIndex].id,
    assetId,
    startUs: 2_000_000,
    durationUs: 5_000_000,
    sourceInUs: 1_000_000
  })
  if (!result.ok) throw new Error(result.error)
}

function run(document: ProjectDocument, clipId: string, cleaned: MediaAsset): void {
  const resolved = resolveVoiceCleanupTarget(document, clipId)
  for (const command of planVoiceCleanup(document, resolved, cleaned, makeId)) {
    const result = applyEditorCommand(document, command)
    if (!result.ok) throw new Error(result.error)
  }
}

function findClip(document: ProjectDocument, id: string): { clip: Clip; track: Track } | undefined {
  return document.tracks
    .flatMap((track) => track.clips.map((clip) => ({ clip, track })))
    .find((item) => item.clip.id === id)
}

describe('clip tiếng', () => {
  it('thay asset tại chỗ, giữ id, vị trí, âm lượng, fade và nhóm', () => {
    const document = project()
    insert(document, 1, 'loi', 'mic')
    applyEditorCommand(document, {
      type: 'clip/update',
      clipId: 'loi',
      patch: { volume: 0.7, fadeInUs: 300_000 }
    })
    applyEditorCommand(document, {
      type: 'clip/set-link-group',
      clipIds: ['loi'],
      linkGroupId: 'g1'
    })

    run(document, 'loi', cleanedOf('mic'))

    expect(findClip(document, 'loi')!.clip).toMatchObject({
      assetId: 'clean_mic',
      startUs: 2_000_000,
      sourceInUs: 1_000_000,
      volume: 0.7,
      fadeInUs: 300_000,
      linkGroupId: 'g1'
    })
  })

  it('làm lại trên clip đã sạch thì lọc từ asset GỐC', () => {
    const document = project()
    insert(document, 1, 'loi', 'mic')
    run(document, 'loi', cleanedOf('mic'))
    expect(resolveVoiceCleanupTarget(document, 'loi').sourceAsset.id).toBe('mic')
  })
})

describe('clip hình mang tiếng', () => {
  it('thêm tiếng sạch cùng khoảng ở lane lời thoại mới, tắt tiếng gốc, gộp nhóm', () => {
    const document = project()
    insert(document, 0, 'hinh', 'cam')
    applyEditorCommand(document, {
      type: 'keyframe/set-tracks',
      target: { kind: 'clip', clipId: 'hinh' },
      tracks: {
        volume: [
          { atUs: 0, v: 1 },
          { atUs: 1_000_000, v: 0.5 }
        ]
      }
    })
    const tracksBefore = document.tracks.length

    run(document, 'hinh', cleanedOf('cam'))

    expect(document.tracks).toHaveLength(tracksBefore + 1)
    const video = findClip(document, 'hinh')!.clip
    expect(video.volume).toBe(0)
    // Còn đường keyframe âm lượng thì mức 0 bị bỏ qua và tiếng bẩn vẫn phát.
    expect(video.keyframes?.volume).toBeUndefined()

    const partner = document.tracks
      .flatMap((track) => track.clips.map((clip) => ({ clip, track })))
      .find((item) => item.clip.assetId === 'clean_cam')!
    expect(partner.track).toMatchObject({ kind: 'audio', role: 'dialogue' })
    expect(partner.clip).toMatchObject({
      startUs: 2_000_000,
      durationUs: 5_000_000,
      sourceInUs: 1_000_000
    })
    expect(partner.clip.keyframes?.volume).toHaveLength(2)
    expect(partner.clip.linkGroupId).toBeTruthy()
    expect(partner.clip.linkGroupId).toBe(video.linkGroupId)
  })

  it('làm lại với mức khác thì thay tiếng sạch cũ, không thêm clip hay lane thứ hai', () => {
    const document = project()
    insert(document, 0, 'hinh', 'cam')
    run(document, 'hinh', cleanedOf('cam', 'clean_light'))
    const tracksAfterFirst = document.tracks.length

    expect(resolveVoiceCleanupTarget(document, 'hinh').mode).toBe('swap-partner')
    run(document, 'hinh', cleanedOf('cam', 'clean_strong'))

    expect(document.tracks).toHaveLength(tracksAfterFirst)
    const audioClips = document.tracks
      .filter((track) => track.kind === 'audio')
      .flatMap((track) => track.clips)
    expect(audioClips.map((clip) => clip.assetId)).toEqual(['clean_strong'])
  })

  it('dùng lane lời thoại có sẵn nếu khoảng đó còn trống', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'track/add',
      trackId: 'thoai',
      kind: 'audio',
      name: 'Thoại',
      role: 'dialogue'
    })
    insert(document, 0, 'hinh', 'cam')
    const tracksBefore = document.tracks.length
    run(document, 'hinh', cleanedOf('cam'))
    expect(document.tracks).toHaveLength(tracksBefore)
    expect(document.tracks.find((track) => track.id === 'thoai')!.clips).toHaveLength(1)
  })
})

describe('từ chối', () => {
  it('clip hình không có tiếng', () => {
    const document = project()
    document.assets.push(
      asset('cam_cam', 'video', { probe: { durationUs: 1, hasVideo: true, hasAudio: false } })
    )
    insert(document, 0, 'hinh', 'cam_cam')
    expect(() => resolveVoiceCleanupTarget(document, 'hinh')).toThrow(/không mang tiếng/)
  })
})
