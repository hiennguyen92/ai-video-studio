import { describe, expect, it } from 'vitest'
import { parseSubtitleFile } from './subtitle-file-parser'

/**
 * Đọc file phụ đề có sẵn.
 *
 * Phép thử bám vào những thứ file thật ngoài đời hay mang theo: xuống dòng kiểu
 * Windows, BOM, khối hỏng, cue đảo thứ tự — chứ không chỉ một file mẫu sạch.
 */

const SRT = `1
00:00:01,500 --> 00:00:03,000
Chốt đơn hôm nay

2
00:00:04,000 --> 00:00:06,250
Số lượng có hạn
nhé cả nhà
`

describe('đọc SRT', () => {
  it('lấy đúng mốc thời gian và chữ', () => {
    const { cues, skipped } = parseSubtitleFile(SRT)
    expect(skipped).toBe(0)
    expect(cues).toEqual([
      { startUs: 1_500_000, endUs: 3_000_000, text: 'Chốt đơn hôm nay' },
      { startUs: 4_000_000, endUs: 6_250_000, text: 'Số lượng có hạn\nnhé cả nhà' }
    ])
  })

  it('xuống dòng kiểu Windows không dính vào cuối câu', () => {
    // `\r` sót lại sẽ đi thẳng lên hình và không ai biết nó ở đâu ra.
    const { cues } = parseSubtitleFile(SRT.replace(/\n/g, '\r\n'))
    expect(cues[0].text).toBe('Chốt đơn hôm nay')
    expect(cues[1].text).toBe('Số lượng có hạn\nnhé cả nhà')
  })

  it('bỏ BOM ở đầu file', () => {
    const { cues, skipped } = parseSubtitleFile(`\uFEFF${SRT}`)
    expect(skipped).toBe(0)
    expect(cues).toHaveLength(2)
  })

  it('sắp lại cue bị đảo thứ tự', () => {
    const reversed = `1
00:00:05,000 --> 00:00:06,000
Sau

2
00:00:01,000 --> 00:00:02,000
Trước
`
    expect(parseSubtitleFile(reversed).cues.map((cue) => cue.text)).toEqual(['Trước', 'Sau'])
  })
})

describe('đọc WebVTT', () => {
  it('bỏ dòng mở đầu và các khối ghi chú, đọc dấu chấm mili giây', () => {
    const vtt = `WEBVTT

NOTE Đây là ghi chú, không phải cue

00:00:02.000 --> 00:00:04.000
Xin chào

00:01.000 --> 00:02.000
Không có phần giờ
`
    const { cues, skipped } = parseSubtitleFile(vtt)
    expect(skipped).toBe(0)
    expect(cues).toEqual([
      { startUs: 1_000_000, endUs: 2_000_000, text: 'Không có phần giờ' },
      { startUs: 2_000_000, endUs: 4_000_000, text: 'Xin chào' }
    ])
  })
})

describe('file hỏng một phần', () => {
  it('bỏ khối hỏng, GIỮ khối tốt, và đếm lại', () => {
    // File tải trên mạng về thường có vài khối lỗi. Mất một câu tốt hơn nhiều
    // so với mất cả bản dịch.
    const broken = `1
không phải dòng thời gian
Câu này mất

2
00:00:01,000 --> 00:00:02,000
Câu này còn

3
00:00:05,000 --> 00:00:05,000
Dài bằng không

4
00:00:07,000 --> 00:00:08,000

`
    const { cues, skipped } = parseSubtitleFile(broken)
    expect(cues).toEqual([{ startUs: 1_000_000, endUs: 2_000_000, text: 'Câu này còn' }])
    // Ba khối bị bỏ: không có dòng thời gian, dài bằng không, và không có chữ.
    expect(skipped).toBe(3)
  })

  it('file rỗng không phải lỗi, chỉ là không có cue nào', () => {
    expect(parseSubtitleFile('')).toEqual({ cues: [], skipped: 0 })
    expect(parseSubtitleFile('   \n\n  ')).toEqual({ cues: [], skipped: 0 })
  })
})
