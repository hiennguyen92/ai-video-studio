import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { planRippleDeleteClips } from '../commands/clip-ripple-delete'
import { documentForExportRange } from './export-range'
import { planFreezeFrame, resolveFreezeFrameSource } from './freeze-frame-planner'
import type { MediaAsset } from './media-asset-types'
import { createEmptyProject } from './project-document-factory'
import { projectDurationUs, type ProjectDocument } from './project-document-types'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleCue, type SubtitleTrack } from './subtitle-types'
import { rippleSubtitleCues } from './subtitle-ripple'

let counter = 0
const makeId = (prefix: string): string => `${prefix}_${(counter += 1)}`

function asset(id: string, kind: MediaAsset['kind']): MediaAsset {
  return {
    id,
    kind,
    name: id,
    source: { path: `/tmp/${id}`, contentHash: id, sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 120_000_000, hasVideo: kind === 'video', hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

const cue = (id: string, startUs: number, endUs: number): SubtitleCue =>
  ({ id, startUs, endUs, text: id }) as SubtitleCue

function subtitleTrack(
  id: string,
  cues: SubtitleCue[],
  source: SubtitleTrack['source']
): SubtitleTrack {
  return { id, name: id, language: 'vi', source, style: { ...DEFAULT_SUBTITLE_STYLE }, cues }
}

/** Lane hình quay người nói (cam), lane nhạc nền; phụ đề phiên âm từ cam. */
function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push(asset('cam', 'video'), asset('nhac', 'audio'))
  for (const [trackIndex, clipId, assetId] of [
    [0, 'hinh', 'cam'],
    [2, 'nen', 'nhac']
  ] as const) {
    const result = applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[trackIndex].id,
      assetId,
      startUs: 0,
      durationUs: 30_000_000,
      sourceInUs: 0
    })
    if (!result.ok) throw new Error(result.error)
  }
  document.transcripts.push({ id: 'tr', assetId: 'cam', language: 'vi', segments: [] } as never)
  document.subtitleTracks.push(
    subtitleTrack('loi', [cue('c1', 9_000_000, 13_000_000), cue('c2', 18_000_000, 22_000_000)], {
      kind: 'transcript',
      refId: 'tr'
    })
  )
  return document
}

describe('rippleSubtitleCues', () => {
  it('câu vắt qua mép khoảng cắt thì co lại, không đứng nguyên giờ cũ', () => {
    const result = rippleSubtitleCues(
      [
        cue('dau', 9_000_000, 13_000_000),
        cue('trong', 14_000_000, 16_000_000),
        cue('cuoi', 18_000_000, 22_000_000)
      ],
      10_000_000,
      20_000_000
    )
    expect(result.map((item) => [item.id, item.startUs, item.endUs])).toEqual([
      ['dau', 9_000_000, 10_000_000],
      ['cuoi', 10_000_000, 12_000_000]
    ])
  })
})

describe('xuất một đoạn', () => {
  it('đoạn 10–20 s ra đúng 10 s, phụ đề vắt mép được cắt đúng chỗ', () => {
    const sliced = documentForExportRange(project(), { startUs: 10_000_000, endUs: 20_000_000 })
    // Trước đây: câu c1 giữ nguyên 9–13 s và file ra dài 13 s.
    expect(projectDurationUs(sliced)).toBe(10_000_000)
    expect(sliced.subtitleTracks[0].cues.map((item) => [item.startUs, item.endUs])).toEqual([
      [0, 3_000_000],
      [8_000_000, 10_000_000]
    ])
  })
})

describe('phụ đề đi theo lane lời nói', () => {
  it('ripple xoá clip trên lane lời nói: phụ đề phiên âm từ clip đó dời theo', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'clip/split',
      clipId: 'hinh',
      atUs: 15_000_000,
      newClipId: 'hinh-sau'
    })
    const plan = planRippleDeleteClips(document, ['hinh'])
    if (!plan || 'error' in plan) throw new Error('không có kế hoạch')
    for (const command of plan.commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    // Xoá 0–15 s trên lane hình: c1 (9–13) mất, c2 (18–22) về 3–7.
    expect(document.subtitleTracks[0].cues.map((item) => [item.id, item.startUs])).toEqual([
      ['c2', 3_000_000]
    ])
  })

  it('cắt lane nhạc: phụ đề của lời nói đứng yên', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'timeline/ripple-delete',
      fromUs: 0,
      toUs: 5_000_000,
      trackIds: [document.tracks[2].id]
    })
    expect(document.subtitleTracks[0].cues[0].startUs).toBe(9_000_000)
  })

  it('phụ đề nhập từ file (không lần ra nguồn) đi theo khi lane lời nói bị cắt', () => {
    const document = project()
    document.subtitleTracks.push(
      subtitleTrack('nhap', [cue('n1', 18_000_000, 20_000_000)], { kind: 'imported' })
    )
    applyEditorCommand(document, {
      type: 'timeline/ripple-delete',
      fromUs: 0,
      toUs: 5_000_000,
      trackIds: [document.tracks[0].id]
    })
    expect(document.subtitleTracks[1].cues[0].startUs).toBe(13_000_000)
  })

  it('đứng hình: câu sau mốc lùi, câu đang hiện kéo dài qua đoạn đứng hình', () => {
    const document = project()
    const source = resolveFreezeFrameSource(document, 'hinh', 10_000_000)
    const freeze = {
      ...asset('dung', 'video'),
      probe: { durationUs: 10_000_000, hasVideo: true, hasAudio: false }
    }
    for (const command of planFreezeFrame(document, source, freeze, 2_000_000, makeId)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.subtitleTracks[0].cues.map((item) => [item.startUs, item.endUs])).toEqual([
      [9_000_000, 15_000_000],
      [20_000_000, 24_000_000]
    ])
  })
})
