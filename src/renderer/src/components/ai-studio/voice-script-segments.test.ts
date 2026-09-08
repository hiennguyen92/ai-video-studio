import { describe, expect, it } from 'vitest'
import { joinSegments, splitScriptIntoSegments } from './voice-script-segments'

describe('splitScriptIntoSegments', () => {
  it('trả về mảng rỗng với kịch bản trống', () => {
    expect(splitScriptIntoSegments('')).toEqual([])
    expect(splitScriptIntoSegments('   \n\n  ')).toEqual([])
  })

  it('tách theo đoạn văn', () => {
    const segments = splitScriptIntoSegments('Đoạn một.\n\nĐoạn hai.\n\nĐoạn ba.')
    expect(segments.map((segment) => segment.text)).toEqual(['Đoạn một.', 'Đoạn hai.', 'Đoạn ba.'])
  })

  it('gộp các dòng trong cùng một đoạn thành một khối liền', () => {
    const segments = splitScriptIntoSegments('Dòng một\nvẫn cùng đoạn.')
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Dòng một vẫn cùng đoạn.')
  })

  it('cắt theo câu khi đoạn vượt giới hạn, giữ nguyên dấu câu', () => {
    const script = `${'a'.repeat(60)}. ${'b'.repeat(60)}. ${'c'.repeat(60)}.`
    const segments = splitScriptIntoSegments(script, { maxCharacters: 80 })

    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(80)
    }
    // Dấu chấm không được rơi rụng khi cắt.
    expect(segments.every((segment) => segment.text.includes('.'))).toBe(true)
  })

  it('cắt theo từ khi một câu đơn lẻ vẫn quá dài', () => {
    const script = Array.from({ length: 60 }, (_, index) => `từ${index}`).join(' ')
    const segments = splitScriptIntoSegments(script, { maxCharacters: 50 })

    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(50)
    }
    // Không được mất chữ nào.
    expect(joinSegments(segments).split(/\s+/).length).toBe(60)
  })

  it('giữ nguyên dấu tiếng Việt', () => {
    const script = 'Xin chào, đây là bản thử nghiệm tiếng Việt có đủ dấu thanh và dấu mũ.'
    const segments = splitScriptIntoSegments(script)
    expect(segments[0].text).toBe(script)
  })

  it('không tách dấu ba chấm thành nhiều câu rỗng', () => {
    const segments = splitScriptIntoSegments('Ngập ngừng… rồi nói tiếp.', { maxCharacters: 100 })
    expect(segments).toHaveLength(1)
    expect(segments[0].text).toBe('Ngập ngừng… rồi nói tiếp.')
  })

  it('mỗi đoạn có id riêng để tạo lại độc lập', () => {
    const segments = splitScriptIntoSegments('Một.\n\nHai.\n\nBa.')
    const ids = new Set(segments.map((segment) => segment.id))
    expect(ids.size).toBe(segments.length)
  })

  it('không để đoạn dài hơn mức làm việc dù model cho phép nhiều hơn', () => {
    // Model cho 40.000 ký tự, nhưng đoạn quá dài thì tạo lại rất lâu và khó soát.
    const script = Array.from({ length: 400 }, () => 'Câu ngắn.').join(' ')
    const segments = splitScriptIntoSegments(script, { maxCharacters: 40_000 })
    expect(segments.length).toBeGreaterThan(1)
    for (const segment of segments) {
      expect(segment.text.length).toBeLessThanOrEqual(800)
    }
  })
})
