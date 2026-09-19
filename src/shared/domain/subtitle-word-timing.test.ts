import { describe, expect, it } from 'vitest'
import { buildSubtitleCues } from './subtitle-cue-builder'
import { rippleSubtitleCues, insertIntoSubtitleCues } from './subtitle-ripple'
import type { SubtitleCue } from './subtitle-types'
import {
  activeWordIndex,
  cueWordStartsUs,
  moveCueTimes,
  splitCuesIntoWordChunks
} from './subtitle-word-timing'
import type { Clip } from './timeline-track-types'
import type { Transcript } from './transcript-types'

/** "một hai ba bốn" 1–3 s, mốc thật lệch hẳn khỏi mốc ước lượng để phân biệt được. */
function cue(overrides: Partial<SubtitleCue> = {}): SubtitleCue {
  return {
    id: 'c',
    startUs: 1_000_000,
    endUs: 3_000_000,
    text: 'một hai ba bốn',
    edited: false,
    words: [
      { text: 'một', startUs: 1_000_000, endUs: 1_100_000 },
      { text: 'hai', startUs: 1_200_000, endUs: 1_300_000 },
      { text: 'ba', startUs: 2_500_000, endUs: 2_600_000 },
      { text: 'bốn', startUs: 2_800_000, endUs: 2_900_000 }
    ],
    ...overrides
  }
}

let counter = 0
const makeId = (): string => `cue_${(counter += 1)}`

describe('cueWordStartsUs', () => {
  it('dùng mốc thật từ transcript khi số chữ khớp', () => {
    expect(cueWordStartsUs(cue())).toEqual([1_000_000, 1_200_000, 2_500_000, 2_800_000])
  })

  it('sửa chính tả một chữ (cùng số chữ): vẫn dùng mốc thật', () => {
    expect(cueWordStartsUs(cue({ text: 'một hai bà bốn' }))[2]).toBe(2_500_000)
  })

  it('không có mốc hoặc số chữ khác: ước lượng theo độ dài chữ, trải đều cả câu', () => {
    const starts = cueWordStartsUs(cue({ words: undefined, text: 'a bbbbbbb' }))
    expect(starts[0]).toBe(1_000_000)
    // "a " nặng 2 phần trên tổng 10: chữ dài bắt đầu ở 20% câu.
    expect(starts[1]).toBe(1_400_000)
    expect(cueWordStartsUs(cue({ text: 'viết lại hẳn cả câu này' }))).toHaveLength(6)
  })

  it('mốc lệch ra ngoài câu hay đảo thứ tự: kẹp vào câu và giữ tăng dần', () => {
    const starts = cueWordStartsUs(
      cue({
        words: [
          { text: 'một', startUs: 0, endUs: 1 },
          { text: 'hai', startUs: 2_700_000, endUs: 1 },
          { text: 'ba', startUs: 2_000_000, endUs: 1 },
          { text: 'bốn', startUs: 9_000_000, endUs: 1 }
        ]
      })
    )
    expect(starts).toEqual([1_000_000, 2_700_000, 2_700_000, 3_000_000])
  })
})

describe('activeWordIndex', () => {
  it('khoảng nghỉ giữa hai chữ vẫn giữ chữ vừa nói sáng', () => {
    const starts = [0, 100, 500]
    expect(activeWordIndex(starts, 0)).toBe(0)
    expect(activeWordIndex(starts, 300)).toBe(1)
    expect(activeWordIndex(starts, 9_999)).toBe(2)
    expect(activeWordIndex([], 5)).toBe(-1)
  })
})

describe('splitCuesIntoWordChunks', () => {
  it('cụm 2 chữ: cụm sau bắt đầu đúng lúc chữ đầu của nó được nói, nối liền nhau', () => {
    const chunks = splitCuesIntoWordChunks([cue()], 2, makeId)
    expect(chunks.map((item) => [item.text, item.startUs, item.endUs])).toEqual([
      ['một hai', 1_000_000, 2_500_000],
      ['ba bốn', 2_500_000, 3_000_000]
    ])
    expect(chunks[1].words?.map((word) => word.text)).toEqual(['ba', 'bốn'])
    expect(new Set(chunks.map((item) => item.id)).size).toBe(2)
  })

  it('câu song ngữ và câu đủ ngắn giữ nguyên', () => {
    const bilingual = cue({ textSecondary: 'one two three four' })
    const short = cue({ id: 'ngan', text: 'một hai', words: undefined })
    expect(splitCuesIntoWordChunks([bilingual, short], 2, makeId)).toEqual([bilingual, short])
  })

  it('câu không có mốc thật: cụm mang mốc ước lượng, vẫn phủ kín câu', () => {
    const chunks = splitCuesIntoWordChunks([cue({ words: undefined })], 3, makeId)
    expect(chunks).toHaveLength(2)
    expect(chunks[0].startUs).toBe(1_000_000)
    expect(chunks[1].endUs).toBe(3_000_000)
    expect(chunks[0].endUs).toBe(chunks[1].startUs)
  })
})

describe('mốc chữ đi theo câu', () => {
  it('kéo cả câu: chữ dời theo; kéo một mép: chữ đứng yên', () => {
    const moved = cue()
    moveCueTimes(moved, 2_000_000, 4_000_000)
    expect(moved.words![2].startUs).toBe(3_500_000)

    const trimmed = cue()
    moveCueTimes(trimmed, 1_000_000, 2_600_000)
    expect(trimmed.words![2].startUs).toBe(2_500_000)
  })

  it('ripple cắt giữa câu: chữ sau khoảng cắt lùi theo, vẫn sáng đúng lúc được nói', () => {
    const [rippled] = rippleSubtitleCues([cue()], 1_500_000, 2_000_000)
    expect(rippled.endUs).toBe(2_500_000)
    expect(rippled.words!.map((word) => word.startUs)).toEqual([
      1_000_000, 1_200_000, 2_000_000, 2_300_000
    ])
  })

  it('chèn đứng hình giữa câu: chữ sau mốc chèn lùi theo', () => {
    const [inserted] = insertIntoSubtitleCues([cue()], 2_000_000, 1_000_000)
    expect(inserted.words!.map((word) => word.startUs)).toEqual([
      1_000_000, 1_200_000, 3_500_000, 3_800_000
    ])
  })
})

describe('buildSubtitleCues mang mốc chữ', () => {
  const transcript = {
    id: 't',
    assetId: 'a',
    language: 'vi',
    languageAutoDetected: false,
    providerId: 'p',
    model: 'm',
    createdAt: '',
    segments: [
      {
        id: 's',
        startUs: 10_000_000,
        endUs: 12_000_000,
        text: 'xin chào',
        edited: false,
        words: [
          { text: 'xin', startUs: 10_000_000, endUs: 10_400_000 },
          { text: 'chào', startUs: 11_000_000, endUs: 11_800_000 }
        ]
      }
    ]
  } as Transcript
  // Clip lấy nguồn từ giây 10, đặt ở giây 2, chạy 2x.
  const clip = {
    id: 'k',
    assetId: 'a',
    startUs: 2_000_000,
    durationUs: 1_000_000,
    sourceInUs: 10_000_000,
    speed: 2
  } as Clip

  it('đổi mốc chữ sang trục timeline, tính cả tốc độ clip', () => {
    const [built] = buildSubtitleCues({ transcript, clips: [clip], bilingual: false, makeId })
    expect(built.words!.map((word) => word.startUs)).toEqual([2_000_000, 2_500_000])
  })

  it('câu hiện bản dịch: không mang mốc của lời gốc', () => {
    const [built] = buildSubtitleCues({
      transcript,
      translation: { segments: [{ sourceSegmentId: 's', text: 'hello there' }] } as never,
      clips: [clip],
      bilingual: false,
      makeId
    })
    expect(built.words).toBeUndefined()
  })
})
