import { describe, expect, it } from 'vitest'
import { combineTransitionStyles, transitionStyleAt } from './clip-transition-style'

describe('transitionStyleAt', () => {
  it('tiến độ 1 là hiện hẳn, không còn dịch chuyển', () => {
    expect(transitionStyleAt('fade', 1, 0).opacity).toBe(1)
    expect(transitionStyleAt('slide-left', 1, 0).transform).toBe('translateX(0%)')
    expect(transitionStyleAt('wipe-left', 1, 0).clipPath).toBe('inset(0 0 0 0%)')
  })

  it('tiến độ 0 là chưa hiện gì', () => {
    expect(transitionStyleAt('fade', 0, 0).opacity).toBe(0)
    expect(transitionStyleAt('slide-left', 0, 0).transform).toBe('translateX(100%)')
  })

  it('dùng CHUNG cho hiệu ứng ra bằng cách cho tiến độ chạy ngược', () => {
    // Ra chỉ là vào chạy ngược. Viết hai bản là mời chúng lệch nhau.
    expect(transitionStyleAt('fade', 0.25, 0).opacity).toBe(0.25)
    expect(transitionStyleAt('slide-up', 0.5, 0).transform).toBe('translateY(50%)')
  })
})

describe('combineTransitionStyles', () => {
  it('không có hiệu ứng ra thì giữ nguyên hiệu ứng vào', () => {
    const enter = { opacity: 0.5, transform: 'scale(2)' }
    expect(combineTransitionStyles(enter, null)).toBe(enter)
  })

  it('độ mờ NHÂN vào nhau khi clip ngắn dính cả hai giai đoạn', () => {
    // Ghi đè sẽ làm clip bật về rõ hẳn rồi mới biến mất.
    const combined = combineTransitionStyles({ opacity: 0.5 }, { opacity: 0.4 })
    expect(combined.opacity).toBeCloseTo(0.2)
  })

  it('phép biến đổi và bộ lọc được nối lại, không đè nhau', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, transform: 'translateX(10%)', filter: 'blur(2px)' },
      { opacity: 1, transform: 'scale(0.5)', filter: 'brightness(2)' }
    )
    expect(combined.transform).toBe('translateX(10%) scale(0.5)')
    expect(combined.filter).toBe('blur(2px) brightness(2)')
  })

  it('phép cắt lấy của hiệu ứng RA, vì đó là thứ đang diễn ra sau cùng', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, clipPath: 'inset(0 0 0 10%)' },
      { opacity: 1, clipPath: 'inset(0 0 0 60%)' }
    )
    expect(combined.clipPath).toBe('inset(0 0 0 60%)')
  })
})
