import type { SubtitleCue, SubtitleStyle } from '../../shared/domain/subtitle-types'
import { wrapSubtitleText } from '../../shared/domain/subtitle-types'
import { cueWordStartsUs } from '../../shared/domain/subtitle-word-timing'

/**
 * Dòng Dialogue của một câu có tô nổi bật từng chữ.
 *
 * Mỗi chữ một dòng Dialogue, phủ đúng lượt sáng của chữ đó; mọi dòng mang CẢ câu,
 * chỉ khác chữ nào mang thẻ màu. Không dùng karaoke `\k` của ASS: `\k` chỉ tô
 * dần (chữ đã qua giữ màu), không làm được kiểu "chỉ chữ đang nói sáng", và mốc
 * của nó tính bằng phần trăm giây cộng dồn nên lệch dần so với preview.
 */
export function highlightedCueEvents(
  cue: SubtitleCue,
  style: SubtitleStyle,
  positionTag: string,
  formatTime: (us: number) => string,
  escape: (text: string) => string
): string[] {
  const highlight = style.wordHighlight
  if (!highlight) return []
  const lines = wrapSubtitleText(cue.text, style.maxCharsPerLine)
  const starts = cueWordStartsUs(cue)
  if (starts.length === 0) return []

  const litColor = inlineAssColor(highlight.color)
  const baseColor = inlineAssColor(style.color)
  const events: string[] = []
  for (const [active, startUs] of starts.entries()) {
    const endUs = starts[active + 1] ?? cue.endUs
    if (endUs <= startUs) continue
    const lit = (index: number): boolean =>
      highlight.mode === 'progressive' ? index <= active : index === active

    let counter = 0
    const text = lines
      .map((line) =>
        line
          .split(/\s+/)
          .filter(Boolean)
          .map((word) => {
            const index = counter
            counter += 1
            return lit(index) ? `{\\1c${litColor}}${escape(word)}{\\1c${baseColor}}` : escape(word)
          })
          .join(' ')
      )
      .join('\\N')
    events.push(
      `Dialogue: 0,${formatTime(startUs)},${formatTime(endUs)},Chinh,,0,0,0,,${positionTag}${text}`
    )
  }
  return events
}

/** Thẻ màu trong dòng của ASS: `&HBBGGRR&`, không có alpha như trong dòng Style. */
export function inlineAssColor(hex: string): string {
  const value = hex.replace('#', '').padEnd(6, '0')
  return `&H${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}&`.toUpperCase()
}
