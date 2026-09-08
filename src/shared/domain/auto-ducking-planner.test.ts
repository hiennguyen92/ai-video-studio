import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { clipEndUs } from './timeline-track-types'
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
 * Lớp thứ hai mới là lớp quan trọng: lệnh cắt sau tham chiếu tới mảnh do lệnh cắt
 * trước tạo ra, nên chỉ nhìn danh sách lệnh thì không thể biết chuỗi có chạy được.
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

const OPTIONS = { duckVolume: 0.25, baseVolume: 1, paddingUs: 0, makeId }

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
    expect(plan.duckedPieces).toBe(0)
  })

  it('cắt nhạc tại ranh giới lời nói và hạ âm lượng đúng mảnh giữa', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 3_000_000, 2_000_000)

    const plan = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })

    // Chạy thật qua reducer: đây mới là bằng chứng chuỗi lệnh móc nối đúng.
    for (const command of plan.commands) {
      const result = applyEditorCommand(document, command)
      expect(result.ok).toBe(true)
    }

    const clips = document.tracks.find((track) => track.id === music)?.clips ?? []
    expect(clips).toHaveLength(3)
    expect(clips.map((clip) => [clip.startUs, clipEndUs(clip), clip.volume])).toEqual([
      [0, 3_000_000, 1],
      [3_000_000, 5_000_000, 0.25],
      [5_000_000, 10_000_000, 1]
    ])
  })

  it('lời nói phủ kín clip nhạc thì hạ cả clip, không cắt vô ích', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 2_000_000, 2_000_000)
    addClip(document, speech, 0, 10_000_000)

    const plan = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    for (const command of plan.commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clips = document.tracks.find((track) => track.id === music)?.clips ?? []
    expect(clips).toHaveLength(1)
    expect(clips[0].volume).toBe(0.25)
    expect(plan.commands.some((command) => command.type === 'clip/split')).toBe(false)
  })

  it('hai đoạn nói tách rời cắt nhạc thành năm mảnh', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 2_000_000, 1_000_000)
    addClip(document, speech, 6_000_000, 1_000_000)

    const plan = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    for (const command of plan.commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clips = document.tracks.find((track) => track.id === music)?.clips ?? []
    expect(clips.map((clip) => clip.volume)).toEqual([1, 0.25, 1, 0.25, 1])
    expect(plan.duckedPieces).toBe(2)
  })

  it('chạy lại lần hai cho ra đúng kết quả lần một', () => {
    const document = projectWithTracks()
    const { music, speech } = trackIds(document)
    addClip(document, music, 0, 10_000_000)
    addClip(document, speech, 3_000_000, 2_000_000)

    const first = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    for (const command of first.commands) applyEditorCommand(document, command)
    const after = document.tracks.find((track) => track.id === music)?.clips.map((c) => c.volume)

    const second = planAutoDucking(document, {
      ...OPTIONS,
      musicTrackIds: [music],
      speechTrackIds: [speech]
    })
    for (const command of second.commands) applyEditorCommand(document, command)

    // Âm lượng không được nhỏ dần sau mỗi lần chạy.
    expect(document.tracks.find((track) => track.id === music)?.clips.map((c) => c.volume)).toEqual(
      after
    )
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
      plan.commands.map((command) => ('clipId' in command ? (command.clipId as string) : ''))
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
