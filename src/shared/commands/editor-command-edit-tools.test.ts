import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Clip } from '../domain/timeline-track-types'
import { applyEditorCommand } from './editor-command-reducer'

function project(kind: 'video' | 'image'): ProjectDocument {
  const document = createEmptyProject({ name: 't' })
  document.assets.push({
    id: 'a',
    kind,
    name: 'a',
    source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: kind === 'image' ? 0 : 20_000_000, hasVideo: true, hasAudio: false },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '',
    missing: false
  } as never)
  if (kind === 'image')
    document.tracks.push({ ...document.tracks[0], id: 'img', kind: 'image', clips: [] })
  const track = document.tracks.find((item) => item.kind === kind)!
  const base = {
    assetId: 'a',
    sourceInUs: 2_000_000,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0
  }
  track.clips.push({ id: 'c1', startUs: 0, durationUs: 3_000_000, ...base })
  track.clips.push({ id: 'c2', startUs: 3_000_000, durationUs: 2_000_000, ...base })
  return document
}

const clips = (document: ProjectDocument, kind: 'video' | 'image'): Clip[] =>
  document.tracks.find((item) => item.kind === kind)!.clips

describe('lệnh của các chế độ công cụ timeline', () => {
  it('ripple trim kéo clip sau lùi lên', () => {
    const document = project('video')
    expect(
      applyEditorCommand(document, {
        type: 'clip/ripple-trim',
        clipId: 'c1',
        edge: 'end',
        toUs: 2_000_000
      }).ok
    ).toBe(true)
    expect(clips(document, 'video').map((clip) => clip.startUs)).toEqual([0, 2_000_000])
  })

  it('slip đổi điểm vào, giữ chỗ; ảnh tĩnh thì từ chối', () => {
    const document = project('video')
    expect(
      applyEditorCommand(document, { type: 'clip/slip', clipId: 'c2', toSourceInUs: 7_000_000 }).ok
    ).toBe(true)
    expect(clips(document, 'video')[1]).toMatchObject({
      startUs: 3_000_000,
      durationUs: 2_000_000,
      sourceInUs: 7_000_000
    })
    const images = project('image')
    expect(
      applyEditorCommand(images, { type: 'clip/slip', clipId: 'c1', toSourceInUs: 0 }).ok
    ).toBe(false)
  })

  it('rate stretch đổi tốc độ và đè clip sau như đổi tốc độ thường; ảnh tĩnh thì từ chối', () => {
    const document = project('video')
    expect(
      applyEditorCommand(document, {
        type: 'clip/rate-stretch',
        clipId: 'c1',
        edge: 'end',
        toUs: 4_000_000
      }).ok
    ).toBe(true)
    const [first, second] = clips(document, 'video')
    expect(first).toMatchObject({ durationUs: 4_000_000, speed: 0.75 })
    expect(second.startUs).toBe(4_000_000)
    const images = project('image')
    expect(
      applyEditorCommand(images, {
        type: 'clip/rate-stretch',
        clipId: 'c1',
        edge: 'end',
        toUs: 4_000_000
      }).ok
    ).toBe(false)
  })

  it('track khoá thì không sửa được', () => {
    const document = project('video')
    document.tracks.find((item) => item.kind === 'video')!.locked = true
    for (const command of [
      { type: 'clip/ripple-trim', clipId: 'c1', edge: 'end', toUs: 2_000_000 },
      { type: 'clip/slip', clipId: 'c1', toSourceInUs: 0 },
      { type: 'clip/rate-stretch', clipId: 'c1', edge: 'end', toUs: 4_000_000 }
    ] as const) {
      expect(applyEditorCommand(document, command).ok).toBe(false)
    }
  })
})
