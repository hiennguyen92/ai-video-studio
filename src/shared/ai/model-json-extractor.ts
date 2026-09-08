/**
 * Bóc một khối JSON ra khỏi văn bản tự do của mô hình ngôn ngữ.
 *
 * Dùng chung cho cả dịch và AI Chat: mô hình nào cũng có thói quen bọc JSON trong
 * khối ```json hoặc thêm một câu dẫn nhập trước khi trả dữ liệu.
 */

export function extractJsonBlock(raw: string): string | null {
  const text = raw.replace(/```(?:json)?/gi, '').trim()

  // Bắt đầu từ dấu mở nào xuất hiện TRƯỚC. Luôn thử "{" trước sẽ cắt nhầm một
  // mảng trần `[{...},{...}]` thành đúng phần tử đầu tiên, và mất sạch phần sau.
  const candidates = [
    ['{', '}'],
    ['[', ']']
  ]
    .map(([open, close]) => ({ open, close, start: text.indexOf(open) }))
    .filter((candidate) => candidate.start !== -1)
    .sort((left, right) => left.start - right.start)

  for (const { open, close, start } of candidates) {
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = start; index < text.length; index += 1) {
      const character = text[index]

      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }

      if (character === '"') inString = true
      else if (character === open) depth += 1
      else if (character === close) {
        depth -= 1
        if (depth === 0) return text.slice(start, index + 1)
      }
    }
  }

  return null
}
