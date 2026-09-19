import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { planSilenceCuts, silenceRangesOnTimeline } from './silence-cut-planner'
import type { Clip } from './timeline-track-types'

const FPS = { num: 30, den: 1 }

function clip(partial: Partial<Clip>): Clip {
  return {
    id: 'c',
    assetId: 'a',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0,
    speed: 1,
    ...partial
  } as Clip
}

describe('silenceRangesOnTimeline', () => {
  it('chừa padding cạnh lời nói, cắt sát ở mép clip', () => {
    const ranges = silenceRangesOnTimeline(
      clip({}),
      [
        { startUs: 0, endUs: 1_000_000 },
        { startUs: 4_000_000, endUs: 6_000_000 }
      ],
      200_000
    )
    expect(ranges).toEqual([
      { startUs: 0, endUs: 800_000 },
      { startUs: 4_200_000, endUs: 5_800_000 }
    ])
  })

  it('quy nguồn → timeline khi clip đã cắt đầu, dời chỗ và phát nhanh gấp đôi', () => {
    const ranges = silenceRangesOnTimeline(
      clip({ startUs: 10_000_000, sourceInUs: 2_000_000, speed: 2, durationUs: 5_000_000 }),
      [{ startUs: 4_000_000, endUs: 8_000_000 }],
      0
    )
    // Nguồn 4 s → timeline 10 + (4-2)/2 = 11 s; nguồn 8 s → 13 s.
    expect(ranges).toEqual([{ startUs: 11_000_000, endUs: 13_000_000 }])
  })

  it('padding nuốt hết khoảng lặng ngắn thì bỏ, không để lại vết cắt vụn', () => {
    expect(
      silenceRangesOnTimeline(clip({}), [{ startUs: 4_000_000, endUs: 4_400_000 }], 200_000)
    ).toEqual([])
  })
})

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
  for (const [trackIndex, clipId, durationUs] of [
    [1, 'loi', 10_000_000],
    [2, 'nhac', 20_000_000]
  ] as const) {
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[trackIndex].id,
      assetId: 'asset_1',
      startUs: 0,
      durationUs,
      sourceInUs: 0
    })
  }
  return document
}

function apply(
  document: ProjectDocument,
  commands: ReturnType<typeof planSilenceCuts>['commands']
): void {
  for (const command of commands) {
    const result = applyEditorCommand(document, command)
    if (!result.ok) throw new Error(result.error)
  }
}

const silences = {
  loi: [
    { startUs: 2_000_000, endUs: 3_000_000 },
    { startUs: 6_000_000, endUs: 8_000_000 }
  ]
}

describe('planSilenceCuts', () => {
  it('chỉ track của clip: lời nói co lại 3 giây, nhạc nền đứng yên', () => {
    const document = project()
    const plan = planSilenceCuts(document, silences, {
      paddingUs: 0,
      scope: 'clip-tracks',
      frameRate: FPS
    })
    expect(plan).toMatchObject({ cutCount: 2, removedUs: 3_000_000 })
    apply(document, plan.commands)

    const speech = document.tracks[1].clips
    expect(speech.map((item) => [item.startUs, item.durationUs])).toEqual([
      [0, 2_000_000],
      [2_000_000, 3_000_000],
      [5_000_000, 2_000_000]
    ])
    expect(document.tracks[2].clips[0].durationUs).toBe(20_000_000)
  })

  it('mọi track: nhạc nền cũng co và marker trôi theo', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'marker/add',
      marker: { id: 'm', atUs: 9_000_000, label: '', color: 'blue' }
    })
    apply(
      document,
      planSilenceCuts(document, silences, { paddingUs: 0, scope: 'all-tracks', frameRate: FPS })
        .commands
    )
    const musicLength = document.tracks[2].clips.reduce((sum, item) => sum + item.durationUs, 0)
    expect(musicLength).toBe(17_000_000)
    expect(document.markers[0].atUs).toBe(6_000_000)
  })

  it('hai nguồn tiếng chồng nhau: chỉ cắt chỗ CẢ HAI cùng im', () => {
    const document = project()
    // Máy quay thu xa "im" suốt 2–6 s, micro cài áo chỉ im ở 4–5 s.
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: 'may',
      trackId: document.tracks[0].id,
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 10_000_000,
      sourceInUs: 0
    })
    const plan = planSilenceCuts(
      document,
      {
        may: [{ startUs: 2_000_000, endUs: 6_000_000 }],
        loi: [{ startUs: 4_000_000, endUs: 5_000_000 }]
      },
      { paddingUs: 0, scope: 'clip-tracks', frameRate: FPS }
    )
    expect(plan).toMatchObject({ cutCount: 1, removedUs: 1_000_000 })
  })

  it('clip đã tắt tiếng không tính là đang có lời', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: 'may',
      trackId: document.tracks[0].id,
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 10_000_000,
      sourceInUs: 0
    })
    applyEditorCommand(document, { type: 'clip/update', clipId: 'may', patch: { volume: 0 } })
    const plan = planSilenceCuts(
      document,
      { may: [], loi: [{ startUs: 2_000_000, endUs: 6_000_000 }] },
      { paddingUs: 0, scope: 'clip-tracks', frameRate: FPS }
    )
    expect(plan).toMatchObject({ cutCount: 1, removedUs: 4_000_000 })
  })

  it('không có khoảng lặng thì không có lệnh', () => {
    expect(
      planSilenceCuts(project(), { loi: [] }, { paddingUs: 0, scope: 'all-tracks', frameRate: FPS })
    ).toEqual({ commands: [], cutCount: 0, removedUs: 0 })
  })
})
