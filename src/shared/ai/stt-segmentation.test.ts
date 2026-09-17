import { describe, expect, it } from 'vitest'
import type { SttSegment } from './ai-provider-contracts'
import { applySttSegmentation, segmentBySentence, segmentByWord } from './stt-segmentation'

const w = (
  text: string,
  startS: number,
  endS: number
): { text: string; startUs: number; endUs: number } => ({
  text,
  startUs: Math.round(startS * 1_000_000),
  endUs: Math.round(endS * 1_000_000)
})

// Hai đoạn whisper, ranh giới đoạn KHÔNG trùng ranh giới câu.
const whisperSegments: SttSegment[] = [
  {
    startUs: 0,
    endUs: 2_000_000,
    text: 'Xin chào các bạn. Hôm',
    words: [
      w('Xin', 0, 0.3),
      w('chào', 0.3, 0.6),
      w('các', 0.6, 0.9),
      w('bạn.', 0.9, 1.4),
      w('Hôm', 1.6, 2)
    ]
  },
  {
    startUs: 2_000_000,
    endUs: 4_000_000,
    text: 'nay trời đẹp quá!',
    words: [w('nay', 2, 2.3), w('trời', 2.3, 2.8), w('đẹp', 2.8, 3.2), w('quá!', 3.2, 4)]
  }
]

describe('chia bản phiên âm theo câu', () => {
  it('gom từ qua ranh giới đoạn của whisper, cắt ở dấu kết câu', () => {
    const sentences = segmentBySentence(whisperSegments)
    expect(sentences.map((segment) => segment.text)).toEqual([
      'Xin chào các bạn.',
      'Hôm nay trời đẹp quá!'
    ])
    expect(sentences[1]).toMatchObject({ startUs: 1_600_000, endUs: 4_000_000 })
    expect(sentences[1].words).toHaveLength(5)
  })

  it('câu dài không dấu chấm thì ngắt ở dấu phẩy sau 12 giây, ngắt cứng ở 20 giây', () => {
    const words = Array.from({ length: 30 }, (_, index) =>
      w(index === 14 ? 'phẩy,' : `từ${index}`, index, index + 0.9)
    )
    const text = words.map((word) => word.text).join(' ')
    const split = segmentBySentence([{ startUs: 0, endUs: 30_000_000, text, words }])
    expect(split[0].text.endsWith('phẩy,')).toBe(true)
    expect(split.every((segment) => segment.endUs - segment.startUs <= 20_000_000)).toBe(true)
  })

  it('đoạn không có mốc từng từ thì giữ nguyên, vẫn gom theo dấu câu', () => {
    const plain: SttSegment[] = [
      { startUs: 0, endUs: 1_000_000, text: 'Một' },
      { startUs: 1_000_000, endUs: 2_000_000, text: 'hai.' }
    ]
    expect(segmentBySentence(plain)).toEqual([
      {
        startUs: 0,
        endUs: 2_000_000,
        text: 'Một hai.',
        words: [
          { startUs: 0, endUs: 1_000_000, text: 'Một' },
          { startUs: 1_000_000, endUs: 2_000_000, text: 'hai.' }
        ]
      }
    ])
  })
})

describe('chia bản phiên âm theo từ', () => {
  it('mỗi từ một đoạn, giữ đúng mốc', () => {
    const words = segmentByWord(whisperSegments)
    expect(words).toHaveLength(9)
    expect(words[3]).toMatchObject({ text: 'bạn.', startUs: 900_000, endUs: 1_400_000 })
  })

  it('từ có mốc đầu = cuối được kéo dài tối thiểu nhưng không đè từ sau', () => {
    const words = segmentByWord([
      { startUs: 0, endUs: 100_000, text: 'a b', words: [w('a', 0, 0), w('b', 0.02, 0.1)] }
    ])
    expect(words[0].endUs).toBe(20_000)
  })

  it('đuôi từ trước lấn sang đầu từ sau (mốc DTW) thì bị kẹp, các đoạn không chồng nhau', () => {
    const words = segmentByWord([
      {
        startUs: 0,
        endUs: 1_000_000,
        text: 'in the',
        words: [w('in', 3.44, 3.6), w('the', 3.54, 3.82)]
      }
    ])
    expect(words.map((word) => [word.startUs, word.endUs])).toEqual([
      [3_440_000, 3_540_000],
      [3_540_000, 3_820_000]
    ])
  })

  it('cụm ngắn (mặc định) giữ nguyên đoạn của whisper', () => {
    expect(applySttSegmentation(whisperSegments, 'phrase')).toBe(whisperSegments)
    expect(applySttSegmentation(whisperSegments, undefined)).toBe(whisperSegments)
  })
})
