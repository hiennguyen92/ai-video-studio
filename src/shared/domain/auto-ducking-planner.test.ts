import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import type { Clip } from './timeline-track-types'
import {
  collectSpeechIntervals,
  guessDuckingTracks,
  hasMusicAndSpeech,
  mergeIntervals,
  planAutoDucking
} from './auto-ducking-planner'

/**
 * Kế hoạch giảm nhạc được kiểm theo hai lớp:
 *
 *   1. Nội dung lệnh sinh ra có đúng không.
 *   2. Chạy chuỗi lệnh đó qua reducer THẬT có ra đúng kết quả không.
 *
 * Lớp thứ hai mới là lớp quan trọng: reducer là nơi kiểm đường dẫn keyframe và
 * kẹp giá trị, nên chỉ nhìn danh sách lệnh thì không biết keyframe có vào được.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function projectWithTracks(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  // createDefaultTracks: video, lồng tiếng (voiceover), nhạc nền (music).
  // Reducer kiểm tra asset có thật trước khi chèn clip, nên phải có sẵn một cái.
  document.assets.push({
    id: 'asset_1',
    kind: 'audio',
    name: 'nhac.wav',
    source: { path: '/tmp/nhac.wav', contentHash: 'hash', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  return document
}

function trackIds(document: ProjectDocument): { music: string; speech: string } {
  const { musicTrackIds, speechTrackIds } = guessDuckingTracks(document)
  return { music: musicTrackIds[0], speech: speechTrackIds[0] }
}

function addClip(
  document: ProjectDocument,
  trackId: string,
  startUs: number,
  durationUs: number
): string {
  const clipId = makeId()
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId,
    assetId: 'asset_1',
    startUs,
    durationUs,
    sourceInUs: 0
  })
  if (!result.ok) throw new Error(result.error)
  return clipId
}

const OPTIONS = { duckVolume: 0.25, baseVolume: 1, paddingUs: 0, rampUs: 300_000 }

describe('mergeIntervals', () => {
  it('gộp hai khoảng chồng nhau', () => {
    expect(
      mergeIntervals([
        { startUs: 0, endUs: 2_000_000 },
        { startUs: 1_000_000, endUs: 3_000_000 }
      ])
    ).toEqual([{ startUs: 0, endUs: 3_000_000 }])
  })

  it('gộp cả hai khoảng chạm sát nhau', () => {
    expect(
      mergeIntervals([
        { startUs: 0, endUs: 1_000_000 },
        { startUs: 1_000_000, endUs: 2_000_000 }
      ])
    ).toEqual([{ startUs: 0, endUs: 2_000_000 }])
  })

  it('giữ nguyên hai khoảng rời nhau', () => {
    expect(
      mergeIntervals([
        { startUs: 0, endUs: 1_000_000 },
        { startUs: 2_000_000, endUs: 3_000_000 }
      ])
    ).toHaveLength(2)
  })

  it('bỏ khoảng rỗng', () => {
    expect(mergeIntervals([{ startUs: 1_000_000, endUs: 1_000_000 }])).toEqual([])
  })
})

describe('collectSpeechIntervals', () => {
  it('nới khoảng ra hai đầu theo padding', () => {
    const document = projectWithTracks()
    const { speech } = trackIds(document)
    addClip(document, speech, 2_000_000, 1_000_000)

    const intervals = collectSpeechIntervals(document, [speech], 200_000)
    expect(intervals).toEqual([{ startUs: 1_800_000, endUs: 3_200_000 }])
  })

  it('không cho phần nới tụt xuống dưới 0', () => {
    const document = projectWithTracks()
    const { speech } = trackIds(document)
    addClip(document, speech, 0, 1_000_000)

    expect(collectSpeechIntervals(document, [speech], 500_000)[0].startUs).toBe(0)
  })

  it('bỏ qua track lời nói đang tắt tiếng', () => {
    const document = projectWithTracks()
    const { speech } = trackIds(document)
    addClip(document, speech, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId: speech, patch: { muted: true } })

    expect(collectSpeechIntervals(document, [speech], 0)).toEqual([])
  })
})

describe('planAutoDucking', () => {
  function run(document: ProjectDocument, music: string, speech: string, extra = {}): number {
    const plan = planAutoDucking(document, {
      ...OPTIONS,
      ...extra,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    // Chạy thật qua reducer: reducer mới là nơi kiểm đường dẫn và khoảng giá trị.
    for (const command of plan.commands) {
      const result = applyEditorCommand(document, command)
      expect(result.ok).toBe(true)
    }
    return plan.duckedClips
  }

  function musicClips(document: ProjectDocument, music: string): Clip[] {
    return document.tracks.find((track) => track.id === music)?.clips ?? []
  }

  it('không làm gì khi không có lời nói nào', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)

    const plan = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    expect(plan.commands).toEqual([])
    expect(plan.duckedClips).toBe(0)
  })

  it('không cắt nhạc, đặt dốc xuống trước và dốc lên sau lời nói', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 3_000_000, 2_000_000)

    expect(run(document, music, speech)).toBe(1)

    const clips = musicClips(document, music)
    expect(clips).toHaveLength(1)
    expect(clips[0].volume).toBe(1)
    expect(clips[0].keyframes?.volume).toEqual([
      { atUs: 0, v: 1 },
      { atUs: 2_700_000, v: 1 },
      { atUs: 3_000_000, v: 0.25 },
      { atUs: 5_000_000, v: 0.25 },
      { atUs: 5_300_000, v: 1 },
      { atUs: 10_000_000, v: 1 }
    ])
  })

  it('mốc keyframe tính từ mép đầu clip, không phải giờ timeline', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 2_000_000, 8_000_000)
    addClip(document, speech, 5_000_000, 1_000_000)

    run(document, music, speech)
    expect(musicClips(document, music)[0].keyframes?.volume?.[2]).toEqual({
      atUs: 3_000_000,
      v: 0.25
    })
  })

  it('lời nói phủ kín clip nhạc thì cả clip nằm ở mức thấp', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 2_000_000, 2_000_000)
    addClip(document, speech, 0, 10_000_000)

    run(document, music, speech)
    expect(musicClips(document, music)[0].keyframes?.volume).toEqual([
      { atUs: 0, v: 0.25 },
      { atUs: 2_000_000, v: 0.25 }
    ])
  })

  it('dốc vắt qua chỗ nối hai clip nhạc thì hai mép khớp giá trị', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 5_000_000)
    addClip(document, music, 5_000_000, 5_000_000)
    // Dốc xuống chạy từ 4,8 s tới 5,2 s — đúng qua chỗ nối.
    addClip(document, speech, 5_200_000, 1_000_000)

    expect(run(document, music, speech, { rampUs: 400_000 })).toBe(2)
    const [first, second] = musicClips(document, music)
    expect(first.keyframes?.volume?.at(-1)).toEqual({ atUs: 5_000_000, v: 0.625 })
    expect(second.keyframes?.volume?.[0]).toEqual({ atUs: 0, v: 0.625 })
  })

  it('hai câu sát nhau thì nhạc nằm dưới luôn, không lên rồi xuống lại', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 2_000_000, 1_000_000)
    // Khoảng trống 0,4 s < hai dốc 0,3 s.
    addClip(document, speech, 3_400_000, 1_000_000)

    run(document, music, speech)
    const values = musicClips(document, music)[0].keyframes?.volume?.map((frame) => frame.v)
    expect(values).toEqual([1, 1, 0.25, 0.25, 1, 1])
  })

  it('chạy lại sau khi dời lời nói thì đường cũ bị thay, clip hết trùng thì về mức nền', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    const early = addClip(document, music, 0, 5_000_000)
    addClip(document, music, 5_000_000, 5_000_000)
    const line = addClip(document, speech, 2_000_000, 1_000_000)

    run(document, music, speech)
    expect(musicClips(document, music)[0].keyframes?.volume).toBeDefined()

    applyEditorCommand(document, { type: 'clip/move', clipId: line, toStartUs: 7_000_000 })
    run(document, music, speech)

    const clips = musicClips(document, music)
    const moved = clips.find((clip) => clip.id === early)
    expect(moved?.keyframes?.volume).toBeUndefined()
    expect(moved?.volume).toBe(1)
    expect(clips[1].keyframes?.volume?.[2]).toEqual({ atUs: 2_000_000, v: 0.25 })
  })

  it('chạy lại lần hai cho ra đúng kết quả lần một', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 3_000_000, 2_000_000)

    run(document, music, speech)
    const after = structuredClone(musicClips(document, music))
    run(document, music, speech)

    // Âm lượng không được nhỏ dần sau mỗi lần chạy.
    expect(musicClips(document, music)).toEqual(after)
  })

  it('không đụng tới clip trên track không được chọn', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 3_000_000, 2_000_000)

    const plan = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    const touchedIds = new Set(
      plan.commands.map((command) =>
        'clipId' in command
          ? (command.clipId as string)
          : 'target' in command && command.target.kind === 'clip'
            ? command.target.clipId
            : ''
      )
    )
    const speechClipIds =
      document.tracks.find((track) => track.id === speech)?.clips.map((clip) => clip.id) ?? []

    for (const id of speechClipIds) expect(touchedIds.has(id)).toBe(false)
  })
})

describe('guessDuckingTracks / hasMusicAndSpeech', () => {
  it('nhận ra track nhạc và track lời nói theo vai trò', () => {
    const document = projectWithTracks()
    const { musicTrackIds, speechTrackIds } = guessDuckingTracks(document)
    expect(musicTrackIds).toHaveLength(1)
    expect(speechTrackIds).toHaveLength(1)
  })

  it('báo chưa đủ dữ liệu khi thiếu một trong hai loại clip', () => {
    const document = projectWithTracks()
    const { music } = trackIds(document)
    expect(hasMusicAndSpeech(document)).toBe(false)

    addClip(document, music, 0, 1_000_000)
    expect(hasMusicAndSpeech(document)).toBe(false)
  })
})
