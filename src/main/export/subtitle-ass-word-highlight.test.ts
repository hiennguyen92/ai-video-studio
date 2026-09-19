import { describe, expect, it } from 'vitest'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleTrack } from '../../shared/domain/subtitle-types'
import { inlineAssColor } from './subtitle-ass-word-highlight'
import { renderAss } from './subtitle-file-writers'

function track(mode: 'word' | 'progressive'): SubtitleTrack {
  return {
    id: 's',
    name: 'Phụ đề',
    language: 'vi',
    source: { kind: 'manual' },
    style: {
      ...DEFAULT_SUBTITLE_STYLE,
      maxCharsPerLine: 8,
      wordHighlight: { mode, color: '#FFE45C' }
    },
    cues: [
      {
        id: 'c',
        startUs: 0,
        endUs: 3_000_000,
        text: 'một hai ba',
        edited: false,
        words: [
          { text: 'một', startUs: 0, endUs: 500_000 },
          { text: 'hai', startUs: 1_000_000, endUs: 1_500_000 },
          { text: 'ba', startUs: 2_000_000, endUs: 2_500_000 }
        ]
      }
    ]
  }
}

const dialogues = (ass: string): string[] =>
  ass.split('\n').filter((line) => line.startsWith('Dialogue:'))

describe('ASS nổi bật từng chữ', () => {
  it('mỗi chữ một dòng Dialogue nối liền, chỉ chữ đang nói mang màu sáng', () => {
    const lines = dialogues(renderAss(track('word'), 1080, 1920))
    const lit = '{\\1c&H5CE4FF&}'
    expect(lines).toEqual([
      `Dialogue: 0,0:00:00.00,0:00:01.00,Chinh,,0,0,0,,${lit}một{\\1c&HFFFFFF&} hai\\Nba`,
      `Dialogue: 0,0:00:01.00,0:00:02.00,Chinh,,0,0,0,,một ${lit}hai{\\1c&HFFFFFF&}\\Nba`,
      `Dialogue: 0,0:00:02.00,0:00:03.00,Chinh,,0,0,0,,một hai\\N${lit}ba{\\1c&HFFFFFF&}`
    ])
  })

  it('tô dần: chữ đã nói giữ màu', () => {
    const last = dialogues(renderAss(track('progressive'), 1080, 1920)).at(-1)!
    expect(last.match(/1c&H5CE4FF&/g)).toHaveLength(3)
  })

  it('tắt thì vẫn là một dòng Dialogue như cũ', () => {
    const plain = track('word')
    delete plain.style.wordHighlight
    expect(dialogues(renderAss(plain, 1080, 1920))).toHaveLength(1)
  })

  it('màu trong dòng là BGR, không có alpha', () => {
    expect(inlineAssColor('#112233')).toBe('&H332211&')
  })
})
