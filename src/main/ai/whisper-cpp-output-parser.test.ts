import { describe, expect, it } from 'vitest'
import {
  mergeTokensIntoWords,
  parseProgressLine,
  parseWhisperJson
} from './whisper-cpp-output-parser'

/**
 * Dữ liệu trong nhóm này được CẮT TỪ OUTPUT THẬT của whisper-cli 1.9.2 chạy trên
 * máy, với model ggml-small và một câu tiếng Việt. Không phải hình dạng phỏng đoán.
 *
 * Giữ nguyên như vậy vì đây chính là hợp đồng dễ vỡ nhất: whisper.cpp từng đổi
 * tên binary và cấu trúc output, nên bất kỳ thay đổi nào ở phía họ phải làm nhóm
 * test này đỏ lên.
 */

const REAL_OUTPUT = JSON.stringify({
  systeminfo: 'NEON = 1 | ARM_FMA = 1 |',
  model: { type: 'small', multilingual: true },
  params: { model: '/models/ggml-small.bin', language: 'vi', translate: false },
  result: { language: 'vi' },
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:02,780' },
      offsets: { from: 0, to: 2780 },
      text: ' Xin chào! Đây là AI Video Studio, bạn',
      tokens: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 }, id: 50364, p: 0.986282 },
        { text: ' Xin', offsets: { from: 70, to: 260 }, id: 8720, p: 0.984805 },
        { text: ' ch', offsets: { from: 260, to: 430 }, id: 764, p: 0.996888 },
        { text: 'ào', offsets: { from: 430, to: 600 }, id: 2346, p: 0.999926 },
        { text: '!', offsets: { from: 600, to: 860 }, id: 0, p: 0.241 },
        { text: ' Đây', offsets: { from: 860, to: 1120 }, id: 1, p: 0.96 },
        { text: ' là', offsets: { from: 1120, to: 1290 }, id: 2, p: 0.997 },
        { text: ' AI', offsets: { from: 1290, to: 1460 }, id: 3, p: 0.911 },
        { text: ' Video', offsets: { from: 1460, to: 1780 }, id: 4, p: 0.894 },
        { text: ' Studio', offsets: { from: 1910, to: 2380 }, id: 5, p: 0.973 },
        { text: ',', offsets: { from: 2620, to: 2620 }, id: 6, p: 0.487 },
        { text: ' bạn', offsets: { from: 2730, to: 2780 }, id: 7, p: 0.786 }
      ]
    },
    {
      timestamps: { from: '00:00:02,780', to: '00:00:04,520' },
      offsets: { from: 2780, to: 4520 },
      text: ' thử nghiệm dọng độc tiếng Việt với đầy',
      tokens: []
    }
  ]
})

describe('parseWhisperJson', () => {
  it('đổi mốc thời gian từ mili giây sang microgiây', () => {
    const parsed = parseWhisperJson(REAL_OUTPUT)

    expect(parsed.segments).toHaveLength(2)
    // 2780 ms trong file phải thành 2_780_000 µs trong ứng dụng.
    expect(parsed.segments[0].startUs).toBe(0)
    expect(parsed.segments[0].endUs).toBe(2_780_000)
    expect(parsed.segments[1].startUs).toBe(2_780_000)
    expect(parsed.segments[1].endUs).toBe(4_520_000)
  })

  it('lấy ngôn ngữ NHẬN DIỆN ĐƯỢC chứ không lấy tham số yêu cầu', () => {
    const autoDetected = JSON.stringify({
      params: { language: 'auto' },
      result: { language: 'vi' },
      transcription: [{ offsets: { from: 0, to: 1000 }, text: 'xin chào' }]
    })
    // `params.language` là thứ ta YÊU CẦU; chỉ `result.language` mới là kết quả.
    expect(parseWhisperJson(autoDetected).language).toBe('vi')
  })

  it('bỏ segment rỗng do khoảng lặng', () => {
    const withSilence = JSON.stringify({
      result: { language: 'vi' },
      transcription: [
        { offsets: { from: 0, to: 500 }, text: '   ' },
        { offsets: { from: 500, to: 1500 }, text: ' có chữ ' }
      ]
    })
    const parsed = parseWhisperJson(withSilence)
    expect(parsed.segments).toHaveLength(1)
    expect(parsed.segments[0].text).toBe('có chữ')
  })

  it('báo lỗi rõ ràng khi JSON hỏng', () => {
    expect(() => parseWhisperJson('{ hỏng')).toThrow(/không đọc được/)
  })
})

describe('mergeTokensIntoWords', () => {
  it('ghép mảnh sub-word thành từ trọn vẹn', () => {
    const parsed = parseWhisperJson(REAL_OUTPUT)
    const words = parsed.segments[0].words ?? []

    // " ch" + "ào" phải thành một từ "chào", không phải hai từ.
    expect(words.map((word) => word.text)).toEqual([
      'Xin',
      'chào!',
      'Đây',
      'là',
      'AI',
      'Video',
      'Studio,',
      'bạn'
    ])
  })

  it('giữ mốc bắt đầu của mảnh đầu và mốc kết thúc của mảnh cuối', () => {
    const parsed = parseWhisperJson(REAL_OUTPUT)
    const chao = (parsed.segments[0].words ?? []).find((word) => word.text.startsWith('chào'))

    // "ch" bắt đầu ở 260 ms; "!" kết thúc ở 860 ms.
    expect(chao?.startUs).toBe(260_000)
    expect(chao?.endUs).toBe(860_000)
  })

  it('loại token đặc biệt của model', () => {
    const words = mergeTokensIntoWords([
      { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
      { text: ' xin', offsets: { from: 100, to: 200 } },
      { text: '[_TT_310]', offsets: { from: 200, to: 200 } }
    ])
    // Token đặc biệt không phải chữ người nói.
    expect(words.map((word) => word.text)).toEqual(['xin'])
  })

  it('không tạo từ rỗng từ token chỉ có khoảng trắng', () => {
    const words = mergeTokensIntoWords([
      { text: ' ', offsets: { from: 0, to: 10 } },
      { text: ' ổn', offsets: { from: 10, to: 100 } }
    ])
    expect(words.map((word) => word.text)).toEqual(['ổn'])
  })

  it('giữ nguyên dấu tiếng Việt sau khi ghép', () => {
    const words = mergeTokensIntoWords([
      { text: ' ngh', offsets: { from: 0, to: 100 } },
      { text: 'iệm', offsets: { from: 100, to: 200 } },
      { text: ' đầy', offsets: { from: 200, to: 300 } },
      { text: ' đủ', offsets: { from: 300, to: 400 } }
    ])
    expect(words.map((word) => word.text)).toEqual(['nghiệm', 'đầy', 'đủ'])
  })
})

describe('parseProgressLine', () => {
  it('đọc được dòng tiến trình thật của whisper.cpp', () => {
    // Dòng này chép nguyên từ stderr khi chạy với cờ -pp.
    expect(parseProgressLine('whisper_print_progress_callback: progress =  40%')).toBe(0.4)
    expect(parseProgressLine('whisper_print_progress_callback: progress = 100%')).toBe(1)
  })

  it('bỏ qua dòng không phải tiến trình', () => {
    expect(parseProgressLine('read_audio_data: reading audio data')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
  })
})

describe('mốc DTW', () => {
  it('có t_dtw thì dùng làm mốc kết thúc của từ; -1 thì dùng offsets', () => {
    const words = mergeTokensIntoWords([
      { text: ' Hello', offsets: { from: 50, to: 450 }, t_dtw: 34 },
      { text: ' ever', offsets: { from: 460, to: 700 }, t_dtw: 70 },
      { text: 'yone', offsets: { from: 700, to: 960 }, t_dtw: 104 },
      { text: ' ok', offsets: { from: 1000, to: 1200 }, t_dtw: -1 }
    ])
    expect(words).toEqual([
      { text: 'Hello', startUs: 50_000, endUs: 340_000 },
      { text: 'everyone', startUs: 460_000, endUs: 1_040_000 },
      { text: 'ok', startUs: 1_000_000, endUs: 1_200_000 }
    ])
  })
})
