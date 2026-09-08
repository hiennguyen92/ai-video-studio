import { describe, expect, it } from 'vitest'
import type { Clip } from './timeline-track-types'
import type { Transcript, Translation } from './transcript-types'
import { buildSubtitleCues, findOverlappingCues } from './subtitle-cue-builder'

/**
 * Phép thử cho bước đổi hệ toạ độ asset → timeline.
 *
 * Sai ở đây không làm ứng dụng lỗi, chỉ làm phụ đề lệch giờ — kiểu hỏng mà chỉ
 * xem lại video mới phát hiện ra. Vì vậy từng ca được kiểm bằng con số cụ thể.
 */

let counter = 0
const makeId = (): string => `cue_${(counter += 1)}`

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...overrides
  }
}

function transcript(): Transcript {
  return {
    id: 'tr_1',
    assetId: 'asset_1',
    language: 'en',
    languageAutoDetected: false,
    providerId: 'whisper-cpp',
    model: 'ggml',
    createdAt: '2026-01-01T00:00:00.000Z',
    segments: [
      { id: 'seg_1', startUs: 1_000_000, endUs: 2_000_000, text: 'One', edited: false },
      { id: 'seg_2', startUs: 3_000_000, endUs: 4_000_000, text: 'Two', edited: false },
      { id: 'seg_3', startUs: 8_000_000, endUs: 9_000_000, text: 'Three', edited: false }
    ]
  }
}

function translation(): Translation {
  return {
    id: 'tl_1',
    transcriptId: 'tr_1',
    sourceLanguage: 'en',
    targetLanguage: 'vi',
    providerId: 'openai-compatible-chat',
    model: 'qwen',
    createdAt: '2026-01-01T00:00:00.000Z',
    glossary: [],
    segments: [
      { id: 'd1', sourceSegmentId: 'seg_1', text: 'Một', edited: false },
      { id: 'd2', sourceSegmentId: 'seg_2', text: 'Hai', edited: false },
      { id: 'd3', sourceSegmentId: 'seg_3', text: 'Ba', edited: false }
    ]
  }
}

describe('buildSubtitleCues', () => {
  it('clip nguyên vẹn ở đầu timeline thì giữ nguyên mốc thời gian', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip()],
      bilingual: false,
      makeId
    })

    expect(cues).toHaveLength(3)
    expect(cues[0].startUs).toBe(1_000_000)
    expect(cues[0].endUs).toBe(2_000_000)
  })

  it('clip nằm giữa timeline thì cue dời theo đúng vị trí clip', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ startUs: 5_000_000 })],
      bilingual: false,
      makeId
    })

    // Đoạn ở giây 1 của asset, clip bắt đầu ở giây 5 → phụ đề hiện ở giây 6.
    expect(cues[0].startUs).toBe(6_000_000)
  })

  it('bỏ hẳn đoạn nằm ngoài phần clip còn giữ lại', () => {
    // Clip chỉ giữ từ giây 0 đến giây 5 của asset; "Three" ở giây 8 đã bị cắt.
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ durationUs: 5_000_000 })],
      bilingual: false,
      makeId
    })

    expect(cues.map((cue) => cue.text)).toEqual(['One', 'Two'])
  })

  it('cắt cụt đoạn chớm mép clip thay vì để chữ hiện quá hình', () => {
    // Clip kết thúc giữa đoạn "Two" (giây 3–4 của asset).
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ durationUs: 3_500_000 })],
      bilingual: false,
      makeId
    })

    const two = cues.find((cue) => cue.text === 'Two')
    expect(two?.startUs).toBe(3_000_000)
    expect(two?.endUs).toBe(3_500_000)
  })

  it('tính điểm vào nguồn khi clip đã bị cắt đầu', () => {
    // Clip bắt đầu từ giây 2 của asset và nằm ở đầu timeline.
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ sourceInUs: 2_000_000, durationUs: 6_000_000 })],
      bilingual: false,
      makeId
    })

    // "One" (giây 1) đã bị cắt mất; "Two" (giây 3) hiện ở giây 1 của timeline.
    expect(cues.map((cue) => cue.text)).toEqual(['Two'])
    expect(cues[0].startUs).toBe(1_000_000)
  })

  it('tốc độ phát nhanh làm lời thoại trôi nhanh tương ứng', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ speed: 2, durationUs: 5_000_000 })],
      bilingual: false,
      makeId
    })

    // Chạy 2x: giây 1 của asset rơi vào giây 0,5 trên timeline.
    expect(cues[0].startUs).toBe(500_000)
    expect(cues[0].endUs).toBe(1_000_000)
  })

  it('một asset dùng ở hai clip thì sinh cue cho cả hai', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [
        clip({ id: 'a', durationUs: 2_500_000 }),
        clip({ id: 'b', startUs: 20_000_000, durationUs: 2_500_000 })
      ],
      bilingual: false,
      makeId
    })

    // Cùng một câu, hiện ở cả hai lần cảnh đó xuất hiện.
    expect(cues).toHaveLength(2)
    expect(cues[0].startUs).toBe(1_000_000)
    expect(cues[1].startUs).toBe(21_000_000)
    // Vẫn truy được về đúng đoạn gốc.
    expect(cues[0].sourceSegmentId).toBe('seg_1')
    expect(cues[1].sourceSegmentId).toBe('seg_1')
  })

  it('bỏ qua clip dùng asset khác', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip({ assetId: 'asset_khac' })],
      bilingual: false,
      makeId
    })
    expect(cues).toHaveLength(0)
  })

  it('có bản dịch thì dòng chính là bản dịch', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      translation: translation(),
      clips: [clip()],
      bilingual: false,
      makeId
    })

    expect(cues[0].text).toBe('Một')
    expect(cues[0].textSecondary).toBeUndefined()
  })

  it('song ngữ thì dòng dưới là bản gốc', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      translation: translation(),
      clips: [clip()],
      bilingual: true,
      makeId
    })

    expect(cues[0].text).toBe('Một')
    expect(cues[0].textSecondary).toBe('One')
  })

  it('bật song ngữ nhưng chưa dịch thì không lặp lại chính câu đó hai lần', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [clip()],
      bilingual: true,
      makeId
    })

    expect(cues[0].text).toBe('One')
    expect(cues[0].textSecondary).toBeUndefined()
  })

  it('bỏ đoạn rỗng thay vì tạo cue trống nhấp nháy trên màn hình', () => {
    const source = transcript()
    source.segments[0].text = '   '
    const cues = buildSubtitleCues({
      transcript: source,
      clips: [clip()],
      bilingual: false,
      makeId
    })

    expect(cues.map((cue) => cue.text)).toEqual(['Two', 'Three'])
  })

  it('xếp cue theo thời gian trình chiếu dù clip nằm lộn xộn', () => {
    const cues = buildSubtitleCues({
      transcript: transcript(),
      clips: [
        clip({ id: 'sau', startUs: 30_000_000, durationUs: 2_500_000 }),
        clip({ id: 'truoc', startUs: 0, durationUs: 2_500_000 })
      ],
      bilingual: false,
      makeId
    })

    expect(cues[0].startUs).toBeLessThan(cues[1].startUs)
  })
})

describe('findOverlappingCues', () => {
  it('phát hiện hai cue chồng giờ nhau', () => {
    const overlaps = findOverlappingCues([
      { id: 'a', startUs: 0, endUs: 2_000_000, text: 'A', edited: false },
      { id: 'b', startUs: 1_000_000, endUs: 3_000_000, text: 'B', edited: false }
    ])
    expect(overlaps).toEqual([['a', 'b']])
  })

  it('cue nối đuôi nhau sát nút không tính là chồng', () => {
    const overlaps = findOverlappingCues([
      { id: 'a', startUs: 0, endUs: 1_000_000, text: 'A', edited: false },
      { id: 'b', startUs: 1_000_000, endUs: 2_000_000, text: 'B', edited: false }
    ])
    expect(overlaps).toEqual([])
  })
})
