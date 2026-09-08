import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_COLOR_GRADE,
  clampColorGrade,
  colorGradeFilterCss,
  isNeutralColorGrade,
  temperatureOverlay,
  vignetteBackgroundCss
} from './clip-color-grade'

/**
 * Chỉnh màu clip.
 *
 * Điều cần chặn ở đây là những cách hỏng KHÔNG kêu: một bộ lọc rỗng vẫn được gắn
 * lên mọi clip (tốn thời gian vẽ mà không đổi gì), hoặc một giá trị vô lý nạp từ
 * file dự án cũ làm trắng xoá cả khung hình.
 */

describe('isNeutralColorGrade', () => {
  it('không chỉnh gì thì coi là trung tính', () => {
    expect(isNeutralColorGrade(undefined)).toBe(true)
    expect(isNeutralColorGrade(NEUTRAL_COLOR_GRADE)).toBe(true)
  })

  it('chỉ cần một thông số lệch là hết trung tính', () => {
    for (const patch of [
      { brightness: 1.2 },
      { contrast: 0.8 },
      { saturation: 1.4 },
      { temperature: -0.5 },
      { vignette: 0.3 }
    ]) {
      expect(isNeutralColorGrade({ ...NEUTRAL_COLOR_GRADE, ...patch })).toBe(false)
    }
  })
})

describe('colorGradeFilterCss', () => {
  it('không chỉnh gì thì KHÔNG sinh filter', () => {
    // Gắn `filter` buộc trình duyệt tách lớp hợp thành riêng cho mọi clip, tốn
    // thời gian vẽ mà không đổi lấy một pixel.
    expect(colorGradeFilterCss(undefined)).toBeUndefined()
    expect(colorGradeFilterCss(NEUTRAL_COLOR_GRADE)).toBeUndefined()
  })

  it('chỉ đưa vào những thông số thật sự lệch', () => {
    const css = colorGradeFilterCss({ ...NEUTRAL_COLOR_GRADE, contrast: 1.3 })

    expect(css).toBe('contrast(1.3)')
    expect(css).not.toContain('brightness')
    expect(css).not.toContain('saturate')
  })

  it('gộp nhiều thông số theo đúng cú pháp CSS', () => {
    const css = colorGradeFilterCss({
      ...NEUTRAL_COLOR_GRADE,
      brightness: 1.1,
      contrast: 1.2,
      saturation: 0.8
    })

    expect(css).toBe('brightness(1.1) contrast(1.2) saturate(0.8)')
  })

  it('nhiệt độ và tối góc KHÔNG nằm trong filter — chúng là lớp phủ', () => {
    expect(
      colorGradeFilterCss({ ...NEUTRAL_COLOR_GRADE, temperature: 1, vignette: 1 })
    ).toBeUndefined()
  })
})

describe('temperatureOverlay', () => {
  it('không đặt nhiệt độ thì không có lớp phủ', () => {
    expect(temperatureOverlay(NEUTRAL_COLOR_GRADE)).toBeUndefined()
  })

  it('ấm ra màu cam, lạnh ra màu xanh', () => {
    const warm = temperatureOverlay({ ...NEUTRAL_COLOR_GRADE, temperature: 0.6 })
    const cool = temperatureOverlay({ ...NEUTRAL_COLOR_GRADE, temperature: -0.6 })

    expect(warm?.color).toBe('#ff8a2b')
    expect(cool?.color).toBe('#2b8aff')
    expect(warm?.opacity).toBeCloseTo(cool!.opacity)
  })

  it('mạnh hơn thì phủ đậm hơn, nhưng không bao giờ phủ kín', () => {
    const soft = temperatureOverlay({ ...NEUTRAL_COLOR_GRADE, temperature: 0.2 })!
    const hard = temperatureOverlay({ ...NEUTRAL_COLOR_GRADE, temperature: 1 })!

    expect(hard.opacity).toBeGreaterThan(soft.opacity)
    // Phủ kín nghĩa là mất sạch hình bên dưới, không còn là chỉnh nhiệt độ nữa.
    expect(hard.opacity).toBeLessThan(0.6)
  })

  it('dùng soft-light để giữ chi tiết vùng sáng và vùng tối', () => {
    expect(temperatureOverlay({ ...NEUTRAL_COLOR_GRADE, temperature: 1 })?.blendMode).toBe(
      'soft-light'
    )
  })
})

describe('vignetteBackgroundCss', () => {
  it('tắt thì không sinh lớp phủ', () => {
    expect(vignetteBackgroundCss(NEUTRAL_COLOR_GRADE)).toBeUndefined()
  })

  it('giữ vùng giữa khung trong suốt để không tối cả chủ thể', () => {
    const css = vignetteBackgroundCss({ ...NEUTRAL_COLOR_GRADE, vignette: 1 })!

    expect(css).toContain('rgba(0,0,0,0) 45%')
    expect(css).toMatch(/rgba\(0,0,0,0\.\d+\) 100%/)
  })

  it('mạnh hơn thì góc tối hơn', () => {
    const weak = vignetteBackgroundCss({ ...NEUTRAL_COLOR_GRADE, vignette: 0.2 })!
    const strong = vignetteBackgroundCss({ ...NEUTRAL_COLOR_GRADE, vignette: 1 })!
    const alphaOf = (css: string): number => Number(/rgba\(0,0,0,([\d.]+)\) 100%/.exec(css)![1])

    expect(alphaOf(strong)).toBeGreaterThan(alphaOf(weak))
    // Không bao giờ đen kịt hoàn toàn ở góc.
    expect(alphaOf(strong)).toBeLessThan(1)
  })
})

describe('clampColorGrade', () => {
  it('kẹp giá trị vô lý về khoảng dùng được', () => {
    const grade = clampColorGrade({
      brightness: 99,
      contrast: -5,
      saturation: 12,
      temperature: 8,
      vignette: -3
    })

    expect(grade.brightness).toBe(1.5)
    expect(grade.contrast).toBe(0.5)
    expect(grade.saturation).toBe(2)
    expect(grade.temperature).toBe(1)
    expect(grade.vignette).toBe(0)
  })

  it('thiếu trường hoặc trường không phải số thì về mức trung tính', () => {
    expect(clampColorGrade({})).toEqual(NEUTRAL_COLOR_GRADE)
    expect(clampColorGrade({ brightness: Number.NaN, contrast: Infinity })).toEqual(
      NEUTRAL_COLOR_GRADE
    )
  })
})
