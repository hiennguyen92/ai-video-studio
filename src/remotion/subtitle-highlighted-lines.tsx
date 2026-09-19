import type { CSSProperties, JSX } from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import type { SubtitleWordHighlight } from '../shared/domain/subtitle-types'
import { activeWordIndex } from '../shared/domain/subtitle-word-timing'

/**
 * Các dòng của câu phụ đề, chữ đang nói được tô màu.
 *
 * Đánh số chữ LIÊN TỤC qua các dòng: dòng đã ngắt bằng `wrapSubtitleText`, hàm đó
 * tách theo khoảng trắng y như `cueWordTokens`, nên chữ thứ i ở đây là chữ thứ i
 * trong mốc. Lớp ghi ASS đánh số cùng cách, nên bản nung sáng đúng chữ như preview.
 *
 * Chỉ đổi `color`: viền, bóng và cỡ giữ nguyên nên dòng chữ không xê dịch khi
 * chữ sáng chạy qua.
 */
export function SubtitleHighlightedLines({
  lines,
  textStyle,
  highlight,
  wordStartOffsetsUs
}: {
  lines: string[]
  textStyle: CSSProperties
  highlight: SubtitleWordHighlight
  wordStartOffsetsUs: number[]
}): JSX.Element {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Frame trong Sequence tính từ đầu câu, cùng gốc với các mốc.
  const active = activeWordIndex(wordStartOffsetsUs, (frame * 1_000_000) / fps)
  const lit = (index: number): boolean =>
    highlight.mode === 'progressive' ? index <= active : index === active

  // Số thứ tự chữ đầu của mỗi dòng, tính trước khi vẽ.
  const rows: Array<{ words: string[]; firstIndex: number }> = []
  let next = 0
  for (const line of lines) {
    const words = line.split(/\s+/).filter(Boolean)
    rows.push({ words, firstIndex: next })
    next += words.length
  }

  return (
    <>
      {rows.map(({ words, firstIndex }, lineIndex) => (
        <span key={lineIndex} style={textStyle}>
          {words.length === 0
            ? '\u00A0'
            : words.map((word, wordIndex) => {
                const on = lit(firstIndex + wordIndex)
                return (
                  <span key={wordIndex}>
                    {wordIndex > 0 ? ' ' : ''}
                    <span
                      data-word-lit={on ? 'true' : undefined}
                      style={on ? { color: highlight.color } : undefined}
                    >
                      {word}
                    </span>
                  </span>
                )
              })}
        </span>
      ))}
    </>
  )
}
