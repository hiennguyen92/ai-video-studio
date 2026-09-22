import { describe, expect, it } from 'vitest'
import {
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuart,
  smootherStep
} from './transition-easing'

const EASINGS = { easeInOutCubic, easeOutQuart, easeOutCubic, smootherStep, easeOutBack }

describe('transition easing', () => {
  it('mọi hàm chạm đúng 0 và 1 ở hai đầu', () => {
    // Điều kiện để chiều RA dùng chung công thức với chiều VÀO: lệch một chút ở
    // hai đầu là clip nhảy một nấc ngay lúc chuyển cảnh bắt đầu.
    for (const [name, ease] of Object.entries(EASINGS)) {
      expect(ease(0), name).toBeCloseTo(0, 10)
      expect(ease(1), name).toBeCloseTo(1, 10)
    }
  })

  it('tăng đơn điệu, không quay ngược giữa chừng', () => {
    // easeOutBack đứng ngoài: quá đà rồi lùi về 1 chính là việc của nó.
    const monotonic = Object.entries(EASINGS).filter(([name]) => name !== 'easeOutBack')
    for (const [name, ease] of monotonic) {
      let previous = -Infinity
      for (let step = 0; step <= 40; step++) {
        const value = ease(step / 40)
        expect(value, `${name} tại ${step / 40}`).toBeGreaterThanOrEqual(previous - 1e-9)
        previous = value
      }
    }
  })

  it('easeOutBack vượt quá 1 ở gần cuối rồi về đúng 1', () => {
    expect(easeOutBack(0.75)).toBeGreaterThan(1)
    expect(easeOutBack(1)).toBeCloseTo(1, 10)
  })

  it('easeInOutCubic chậm ở đầu, nhanh ở giữa', () => {
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1)
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9)
  })
})
