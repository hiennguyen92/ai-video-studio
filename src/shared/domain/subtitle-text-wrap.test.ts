import { describe, expect, it } from 'vitest'
import { wrapSubtitleText } from './subtitle-types'

describe('ngắt dòng chữ', () => {
  it('giữ xuống dòng người dùng gõ', () => {
    // Trước đây mọi khoảng trắng — kể cả Enter — bị gộp thành một dấu cách, nên
    // gõ xuống dòng trong ô nội dung mà hình vẫn một dòng.
    expect(wrapSubtitleText('Chốt đơn\nhôm nay', 40)).toEqual(['Chốt đơn', 'hôm nay'])
    expect(wrapSubtitleText('Dòng một\r\nDòng hai', 40)).toEqual(['Dòng một', 'Dòng hai'])
  })

  it('mỗi đoạn vẫn tự ngắt mềm theo số ký tự', () => {
    expect(wrapSubtitleText('một hai ba bốn\nnăm', 8)).toEqual(['một hai', 'ba bốn', 'năm'])
  })

  it('dòng trống giữa hai đoạn được giữ thành chuỗi rỗng', () => {
    expect(wrapSubtitleText('Tiêu đề\n\nGiá 99k', 40)).toEqual(['Tiêu đề', '', 'Giá 99k'])
  })

  it('không có chữ nào thì không có dòng nào', () => {
    expect(wrapSubtitleText('', 40)).toEqual([])
    expect(wrapSubtitleText(' \n  \n', 40)).toEqual([])
  })

  it('văn bản một dòng giữ nguyên hành vi cũ', () => {
    expect(wrapSubtitleText('  nhiều   khoảng   trắng  ', 40)).toEqual(['nhiều khoảng trắng'])
  })
})
