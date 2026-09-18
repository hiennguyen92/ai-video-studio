import { describe, expect, it } from 'vitest'
import {
  applyTextOverlayBox,
  applyTextOverlayFrame,
  createDefaultTextOverlayStyle,
  readTextOverlayBox,
  textOverlayLines
} from './text-overlay-types'
import { TEXT_FRAME_PALETTES } from './text-frame-catalog'

/**
 * Nền hộp phải đổi CÙNG LÚC màu chữ và viền. Ba thứ đó lệch nhau thì chữ vẫn
 * hiện trên preview nhưng không đọc được — kiểu hỏng chỉ lộ ra khi nhìn video.
 */
describe('nền hộp cho chữ', () => {
  it('đổi qua lại giữa các kiểu hộp luôn ra style đọc được', () => {
    let style = createDefaultTextOverlayStyle()

    style = applyTextOverlayBox(style, 'light')
    expect(readTextOverlayBox(style)).toBe('light')
    expect(style.color).not.toBe(style.boxColor)

    style = applyTextOverlayBox(style, 'dark')
    expect(readTextOverlayBox(style)).toBe('dark')
    expect(style.color).not.toBe(style.boxColor)

    // Bỏ hộp phải TRẢ LẠI viền: chữ trắng không viền nằm trần trên nền sáng là
    // biến mất, và người dùng chỉ thấy điều đó sau khi đã xuất video.
    style = applyTextOverlayBox(style, 'none')
    expect(readTextOverlayBox(style)).toBe('none')
    expect(style.outlineWidthPx).toBeGreaterThan(0)
    expect(style.color).toBe('#FFFFFF')
  })

  it('giữ nguyên những phần không liên quan tới hộp', () => {
    const style = createDefaultTextOverlayStyle()
    const boxed = applyTextOverlayBox({ ...style, fontSizePx: 120, alignment: 2 }, 'dark')

    expect(boxed.fontSizePx).toBe(120)
    expect(boxed.alignment).toBe(2)
  })
})

/**
 * Khung nền thay thế nền hộp phẳng, không cộng thêm vào nó. Hai thứ vẽ chồng lên
 * nhau thì cái hộp xám chữ nhật thò ra sau khung bo góc — và chỉ lộ ra khi đã
 * xuất video.
 */
describe('khung nền cho chữ', () => {
  it('đặt màu chữ theo bộ màu và tắt hẳn nền hộp cũ', () => {
    const palette = TEXT_FRAME_PALETTES[0]
    const style = applyTextOverlayFrame(
      applyTextOverlayBox(createDefaultTextOverlayStyle(), 'dark'),
      palette
    )

    expect(style.color).toBe(palette.text)
    expect(style.boxOpacity).toBe(0)
    expect(readTextOverlayBox(style)).toBe('none')
    // Viền chữ phải tắt: nét viền đen quanh chữ nằm trên ruột khung màu kem nhìn
    // ra chữ bẩn, đúng lý do `applyTextOverlayBox` cũng tắt viền khi có hộp.
    expect(style.outlineWidthPx).toBe(0)
  })

  it('giữ nguyên những phần không liên quan tới khung', () => {
    const style = createDefaultTextOverlayStyle()
    const framed = applyTextOverlayFrame(
      { ...style, fontSizePx: 120, alignment: 2 },
      TEXT_FRAME_PALETTES[2]
    )

    expect(framed.fontSizePx).toBe(120)
    expect(framed.alignment).toBe(2)
  })
})

/**
 * Chữ overlay xuống dòng theo ĐÚNG những gì người dùng gõ.
 *
 * Trước đây nó dùng chung phép ngắt mềm với phụ đề (22 ký tự một dòng), nên một
 * câu hook gõ liền bị bẻ đôi trên hình mà không có ô nào chỉnh được chỗ bẻ.
 */
describe('ngắt dòng chữ overlay', () => {
  it('câu dài không có Enter vẫn nằm một dòng', () => {
    expect(textOverlayLines('Chốt đơn hôm nay, số lượng có hạn nhé cả nhà')).toEqual([
      'Chốt đơn hôm nay, số lượng có hạn nhé cả nhà'
    ])
  })

  it('xuống dòng đúng chỗ người dùng gõ Enter', () => {
    expect(textOverlayLines('Chốt đơn\nhôm nay')).toEqual(['Chốt đơn', 'hôm nay'])
    expect(textOverlayLines('Tiêu đề\n\nGiá 99k')).toEqual(['Tiêu đề', '', 'Giá 99k'])
  })

  it('không có chữ nào thì không có dòng nào', () => {
    expect(textOverlayLines('')).toEqual([])
    expect(textOverlayLines(' \n  ')).toEqual([])
  })
})
