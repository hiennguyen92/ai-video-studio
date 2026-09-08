import { describe, expect, it } from 'vitest'
import {
  applyTextOverlayBox,
  createDefaultTextOverlayStyle,
  readTextOverlayBox
} from './text-overlay-types'

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
