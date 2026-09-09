import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRACK_HEIGHT,
  TRACK_HEIGHT_PRESETS,
  looseLaneHeight,
  trackHeightPresetOf
} from './timeline-track-types'

describe('cỡ lane', () => {
  it('ba nấc, tăng dần, và nấc giữa là mặc định', () => {
    expect(TRACK_HEIGHT_PRESETS.map((item) => item.id)).toEqual(['small', 'medium', 'large'])
    const px = TRACK_HEIGHT_PRESETS.map((item) => item.px)
    expect(px).toEqual([...px].sort((left, right) => left - right))
    // Đổi mặc định mà quên nấc giữa thì mở dự án cũ lên ô chọn hiện sai nấc.
    expect(TRACK_HEIGHT_PRESETS[1].px).toBe(DEFAULT_TRACK_HEIGHT)
  })

  it('nhận đúng nấc khi chiều cao trùng khớp', () => {
    for (const preset of TRACK_HEIGHT_PRESETS) {
      expect(trackHeightPresetOf(preset.px)).toBe(preset.id)
    }
  })

  it('chiều cao lạ thì trả về nấc GẦN NHẤT, không trả về rỗng', () => {
    // Dự án cũ hoặc dự án do agent sửa có thể mang con số không trùng nấc nào;
    // ô chọn phải hiện một giá trị chứ không trơ ra trống.
    expect(trackHeightPresetOf(42)).toBe('small')
    expect(trackHeightPresetOf(60)).toBe('medium')
    expect(trackHeightPresetOf(300)).toBe('large')
    expect(trackHeightPresetOf(0)).toBe('small')
  })

  it('lane ảo thấp hơn lane thường nhưng co theo cùng cỡ', () => {
    const heights = TRACK_HEIGHT_PRESETS.map((item) => looseLaneHeight(item.px))
    for (const [index, height] of heights.entries()) {
      expect(height).toBeLessThan(TRACK_HEIGHT_PRESETS[index].px)
      expect(height).toBeGreaterThan(20)
    }
    expect(heights).toEqual([...heights].sort((left, right) => left - right))
  })
})
