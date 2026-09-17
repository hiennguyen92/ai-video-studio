import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { rebuildTrackCues } from './subtitle-track-source'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleTrack } from './subtitle-types'

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 't' })
  document.tracks[0].clips.push({
    id: 'c',
    assetId: 'a',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0
  })
  document.transcripts = [
    {
      id: 'tr',
      assetId: 'a',
      language: 'en',
      segments: [{ id: 's1', startUs: 1_000_000, endUs: 2_000_000, text: 'Hello', edited: false }]
    } as never
  ]
  document.translations = [
    {
      id: 'tl',
      transcriptId: 'tr',
      targetLanguage: 'vi',
      segments: [{ sourceSegmentId: 's1', text: 'Xin chào', edited: false }]
    } as never
  ]
  return document
}

const track = (source: SubtitleTrack['source'], secondaryLanguage?: string): SubtitleTrack => ({
  id: 'sub',
  name: 'x',
  language: 'vi',
  secondaryLanguage,
  source,
  style: DEFAULT_SUBTITLE_STYLE,
  cues: []
})

let n = 0
const makeId = (): string => `cue${(n += 1)}`

describe('dựng lại cue theo nguồn của chính track', () => {
  it('track từ bản phiên âm lấy lời gốc', () => {
    const cues = rebuildTrackCues(project(), track({ kind: 'transcript', refId: 'tr' }), makeId)
    expect(cues?.map((cue) => cue.text)).toEqual(['Hello'])
  })

  it('track từ bản dịch lấy lời dịch, song ngữ thì kèm dòng gốc', () => {
    const cues = rebuildTrackCues(
      project(),
      track({ kind: 'translation', refId: 'tl' }, 'en'),
      makeId
    )
    expect(cues?.[0]).toMatchObject({ text: 'Xin chào', textSecondary: 'Hello' })
  })

  it('nguồn đã xoá, track tay, hoặc không còn clip thì không dựng được', () => {
    expect(
      rebuildTrackCues(project(), track({ kind: 'transcript', refId: 'mat' }), makeId)
    ).toBeNull()
    expect(rebuildTrackCues(project(), track({ kind: 'manual' }), makeId)).toBeNull()
    const noClip = project()
    noClip.tracks[0].clips = []
    expect(rebuildTrackCues(noClip, track({ kind: 'transcript', refId: 'tr' }), makeId)).toBeNull()
  })
})
