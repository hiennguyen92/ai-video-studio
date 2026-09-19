import type { SubtitleCue, SubtitleCueWord } from './subtitle-types'
import type { Micros } from './time-units'

/**
 * Mốc từng chữ của một câu phụ đề — nền của phụ đề nổi bật từng chữ.
 *
 * "Chữ" ở đây là chuỗi giữa hai khoảng trắng, đúng như `wrapSubtitleText` tách:
 * nhờ vậy chữ thứ i trong mốc là chữ thứ i trên màn hình, dù câu ngắt mấy dòng.
 */

export function cueWordTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

/**
 * Mốc BẮT ĐẦU "lượt sáng" của từng chữ. Chữ i sáng từ `starts[i]` tới
 * `starts[i + 1]` (chữ cuối tới hết câu) — liền mạch, không có khe: khoảng nghỉ
 * giữa hai chữ vẫn giữ chữ vừa nói sáng, thay vì cả câu nhấp nháy tắt.
 *
 * Mốc thật lấy từ transcript khi số chữ còn khớp với câu. Sửa chính tả một chữ
 * vẫn khớp; viết lại câu thành số chữ khác, hay câu từ bản dịch / file SRT, thì
 * mốc được ƯỚC LƯỢNG chia theo độ dài chữ — chữ dài đọc lâu hơn.
 */
export function cueWordStartsUs(cue: SubtitleCue): Micros[] {
  const tokens = cueWordTokens(cue.text)
  if (tokens.length === 0) return []
  const real = cue.words && cue.words.length === tokens.length ? cue.words : undefined
  const raw = real ? real.map((word) => word.startUs) : estimatedStarts(cue, tokens)

  // Kẹp vào trong câu và giữ thứ tự tăng dần: mốc lệch (sửa tay mốc câu, transcript
  // chồng chéo) không được làm một chữ sáng trước chữ đứng trước nó.
  const starts: Micros[] = []
  for (const [index, value] of raw.entries()) {
    const clamped = Math.min(cue.endUs, Math.max(cue.startUs, value))
    starts.push(index === 0 ? cue.startUs : Math.max(starts[index - 1], clamped))
  }
  return starts
}

function estimatedStarts(cue: SubtitleCue, tokens: string[]): Micros[] {
  const weights = tokens.map((token) => token.length + 1)
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const span = cue.endUs - cue.startUs
  const starts: Micros[] = []
  let passed = 0
  for (const weight of weights) {
    starts.push(cue.startUs + Math.round((span * passed) / total))
    passed += weight
  }
  return starts
}

/** Chữ đang sáng tại `atUs`, hoặc -1 khi câu không có chữ nào. */
export function activeWordIndex(starts: readonly Micros[], atUs: Micros): number {
  let active = starts.length > 0 ? 0 : -1
  for (let index = 1; index < starts.length; index += 1) {
    if (starts[index] <= atUs) active = index
    else break
  }
  return active
}

/** Dời mốc chữ cùng câu khi CẢ câu dời (kéo câu, ripple, chèn đứng hình). */
export function shiftCueWords(
  words: readonly SubtitleCueWord[] | undefined,
  deltaUs: Micros
): SubtitleCueWord[] | undefined {
  if (!words || deltaUs === 0) return words ? [...words] : undefined
  return words.map((word) => ({
    ...word,
    startUs: word.startUs + deltaUs,
    endUs: word.endUs + deltaUs
  }))
}

/**
 * Chia câu thành các cụm tối đa `maxWords` chữ — kiểu phụ đề TikTok / Reels, mỗi
 * lúc chỉ vài chữ trên màn hình.
 *
 * Mỗi cụm bắt đầu đúng lúc chữ đầu của nó sáng và kéo tới lúc cụm sau bắt đầu, nên
 * các cụm nối liền nhau như câu gốc. Câu song ngữ giữ nguyên: dòng dịch không có
 * mốc từng chữ, cắt nó theo cụm của dòng kia là ghép sai nghĩa.
 */
export function splitCuesIntoWordChunks(
  cues: readonly SubtitleCue[],
  maxWords: number,
  makeId: () => string
): SubtitleCue[] {
  const size = Math.max(1, Math.floor(maxWords))
  return cues.flatMap((cue) => {
    const tokens = cueWordTokens(cue.text)
    if (cue.textSecondary || tokens.length <= size) return [cue]

    const starts = cueWordStartsUs(cue)
    const real = cue.words && cue.words.length === tokens.length ? cue.words : undefined
    const chunks: SubtitleCue[] = []
    for (let from = 0; from < tokens.length; from += size) {
      const to = Math.min(tokens.length, from + size)
      const startUs = starts[from]
      const endUs = to < tokens.length ? starts[to] : cue.endUs
      // Ước lượng dồn nhiều chữ vào cùng một mốc (câu quá ngắn): bỏ cụm rỗng.
      if (endUs <= startUs) continue
      chunks.push({
        ...cue,
        id: makeId(),
        startUs,
        endUs,
        text: tokens.slice(from, to).join(' '),
        words: real
          ? real.slice(from, to)
          : tokens.slice(from, to).map((text, offset) => ({
              text,
              startUs: starts[from + offset],
              endUs: starts[from + offset + 1] ?? cue.endUs
            }))
      })
    }
    return chunks.length > 0 ? chunks : [cue]
  })
}

/**
 * Đặt mốc mới cho câu (sửa trên chỗ — dùng trong reducer).
 *
 * Dời CẢ câu (hai mép cùng dời một khoảng) thì mốc chữ dời theo: lời vẫn nằm
 * nguyên trong câu. Kéo MỘT mép thì mốc chữ đứng yên: người dùng đang cắt bớt
 * hay nới câu quanh lời, không dời lời đi — chữ nằm ngoài câu mới được kẹp lại
 * lúc vẽ.
 */
export function moveCueTimes(cue: SubtitleCue, startUs: Micros, endUs: Micros): void {
  const delta = startUs - cue.startUs
  if (cue.words && delta !== 0 && endUs - cue.endUs === delta) {
    cue.words = shiftCueWords(cue.words, delta)
  }
  cue.startUs = startUs
  cue.endUs = endUs
}
