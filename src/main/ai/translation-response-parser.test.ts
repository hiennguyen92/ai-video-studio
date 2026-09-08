import { describe, expect, it } from 'vitest'
import {
  extractJsonBlock,
  findGlossaryViolations,
  parseTranslationResponse
} from './translation-response-parser'
import { buildTranslationMessages, chunkSegments, languageName } from './translation-prompt-builder'

/**
 * Các trường hợp ở đây là những kiểu trả lời SAI mà mô hình ngôn ngữ thật sự hay
 * mắc, không phải trường hợp giả định cho đủ số test. Mỗi phép thử tương ứng một
 * cách làm lệch liên kết giữa bản dịch và transcript.
 */

const IDS = ['s1', 's2', 's3']

describe('extractJsonBlock', () => {
  it('bóc được JSON nằm trong khối markdown', () => {
    const raw = 'Sure, here you go:\n```json\n{"segments":[{"id":"s1","text":"Xin chào"}]}\n```'
    expect(extractJsonBlock(raw)).toBe('{"segments":[{"id":"s1","text":"Xin chào"}]}')
  })

  it('không cắt nhầm khi chính bản dịch có chứa dấu ngoặc nhọn', () => {
    const raw = '{"segments":[{"id":"s1","text":"Dùng cú pháp {tên} để chèn biến"}]}'
    expect(extractJsonBlock(raw)).toBe(raw)
  })

  it('không cắt nhầm khi bản dịch có dấu nháy đã escape', () => {
    const raw = '{"segments":[{"id":"s1","text":"Anh ấy nói \\"xin chào\\" rồi đi"}]}'
    expect(extractJsonBlock(raw)).toBe(raw)
  })

  it('trả về null khi không có JSON nào', () => {
    expect(extractJsonBlock('Tôi không dịch được đoạn này.')).toBeNull()
  })
})

describe('parseTranslationResponse', () => {
  it('giữ đúng liên kết theo id, không theo thứ tự trả về', () => {
    // Mô hình đảo thứ tự — vẫn phải khớp đúng từng đoạn.
    const raw =
      '{"segments":[{"id":"s3","text":"Ba"},{"id":"s1","text":"Một"},{"id":"s2","text":"Hai"}]}'
    const result = parseTranslationResponse(raw, IDS)

    expect(result.missingIds).toEqual([])
    expect(result.segments).toEqual([
      { sourceSegmentId: 's3', text: 'Ba' },
      { sourceSegmentId: 's1', text: 'Một' },
      { sourceSegmentId: 's2', text: 'Hai' }
    ])
  })

  it('báo thiếu khi mô hình bỏ sót đoạn cuối', () => {
    const raw = '{"segments":[{"id":"s1","text":"Một"},{"id":"s2","text":"Hai"}]}'
    const result = parseTranslationResponse(raw, IDS)

    // Phải báo thiếu để lớp trên hỏi lại, tuyệt đối không tự đôn đoạn khác lên.
    expect(result.missingIds).toEqual(['s3'])
    expect(result.segments).toHaveLength(2)
  })

  it('bỏ qua id bịa ra nhưng vẫn báo lại', () => {
    const raw =
      '{"segments":[{"id":"s1","text":"Một"},{"id":"s99","text":"Của trời ơi"},{"id":"s2","text":"Hai"},{"id":"s3","text":"Ba"}]}'
    const result = parseTranslationResponse(raw, IDS)

    expect(result.unknownIds).toEqual(['s99'])
    expect(result.segments.map((segment) => segment.sourceSegmentId)).toEqual(['s1', 's2', 's3'])
  })

  it('gặp id lặp thì lấy bản đầu tiên và báo lại', () => {
    const raw =
      '{"segments":[{"id":"s1","text":"Một"},{"id":"s1","text":"Một nữa"},{"id":"s2","text":"Hai"},{"id":"s3","text":"Ba"}]}'
    const result = parseTranslationResponse(raw, IDS)

    expect(result.duplicateIds).toEqual(['s1'])
    expect(result.segments[0]).toEqual({ sourceSegmentId: 's1', text: 'Một' })
  })

  it('chấp nhận mảng trần không có object bọc ngoài', () => {
    const raw = '[{"id":"s1","text":"Một"},{"id":"s2","text":"Hai"},{"id":"s3","text":"Ba"}]'
    expect(parseTranslationResponse(raw, IDS).missingIds).toEqual([])
  })

  it('chấp nhận id trả về dưới dạng số', () => {
    const raw = '{"segments":[{"id":1,"text":"Một"}]}'
    expect(parseTranslationResponse(raw, ['1']).segments).toEqual([
      { sourceSegmentId: '1', text: 'Một' }
    ])
  })

  it('coi như thiếu toàn bộ khi JSON hỏng, không ném lỗi', () => {
    const result = parseTranslationResponse('{"segments":[{"id":"s1",', IDS)
    expect(result.segments).toEqual([])
    expect(result.missingIds).toEqual(IDS)
  })

  it('coi như thiếu toàn bộ khi mô hình chỉ trả lời bằng văn xuôi', () => {
    const result = parseTranslationResponse('Xin lỗi, tôi không thể dịch nội dung này.', IDS)
    expect(result.missingIds).toEqual(IDS)
  })
})

describe('findGlossaryViolations', () => {
  const glossary = [{ from: 'timeline', to: 'dòng thời gian' }]

  it('phát hiện đoạn phớt lờ glossary', () => {
    const violations = findGlossaryViolations(
      [
        {
          sourceSegmentId: 's1',
          sourceText: 'Drag it on the timeline',
          translatedText: 'Kéo nó lên timeline'
        },
        {
          sourceSegmentId: 's2',
          sourceText: 'The timeline is empty',
          translatedText: 'Dòng thời gian đang trống'
        }
      ],
      glossary
    )

    expect(violations).toHaveLength(1)
    expect(violations[0].sourceSegmentId).toBe('s1')
  })

  it('không báo với đoạn nguồn không chứa thuật ngữ', () => {
    const violations = findGlossaryViolations(
      [{ sourceSegmentId: 's1', sourceText: 'Hello there', translatedText: 'Xin chào' }],
      glossary
    )
    expect(violations).toEqual([])
  })
})

describe('buildTranslationMessages', () => {
  it('gửi kèm id và nêu rõ số lượng cần trả về', () => {
    const messages = buildTranslationMessages({
      sourceLanguage: 'en',
      targetLanguage: 'vi',
      glossary: [],
      segments: [
        { id: 's1', text: 'Hello' },
        { id: 's2', text: 'World' }
      ]
    })

    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Vietnamese')
    expect(messages[0].content).toContain('Never merge, split, reorder, drop, or invent segments.')
    expect(messages[1].content).toContain('all 2 ids')
    expect(messages[1].content).toContain('"s2"')
  })

  it('đưa glossary vào prompt khi có', () => {
    const messages = buildTranslationMessages({
      targetLanguage: 'vi',
      glossary: [{ from: 'timeline', to: 'dòng thời gian' }],
      segments: [{ id: 's1', text: 'timeline' }]
    })
    expect(messages[0].content).toContain('"timeline" => "dòng thời gian"')
  })

  it('không nhắc glossary khi danh sách rỗng', () => {
    const messages = buildTranslationMessages({
      targetLanguage: 'vi',
      glossary: [],
      segments: [{ id: 's1', text: 'x' }]
    })
    expect(messages[0].content).not.toContain('Glossary')
  })
})

describe('chunkSegments', () => {
  it('chia đúng kích thước lô', () => {
    expect(chunkSegments([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('không rơi vào vòng lặp vô hạn với kích thước lô bằng 0', () => {
    expect(chunkSegments([1, 2], 0)).toEqual([[1], [2]])
  })
})

describe('languageName', () => {
  it('đổi mã ngôn ngữ sang tên mô hình hiểu rõ hơn', () => {
    expect(languageName('vi')).toBe('Vietnamese')
    // Mã có vùng vẫn phải nhận ra.
    expect(languageName('en-US')).toBe('English')
  })

  it('giữ nguyên mã lạ thay vì bịa tên', () => {
    expect(languageName('xx')).toBe('xx')
  })
})
