import { describe, expect, it } from 'vitest'
import { enterProgressAt, exitProgressAt } from './clip-transition-progress'

describe('tiến độ chuyển cảnh ở hai mép', () => {
  it('hai phía của một chỗ nối cộng lại đúng 1 ở TỪNG khung', () => {
    // Bất biến duy nhất giữ cho hai mặt nạ bù nhau. Lệch một chút ở đây là hở
    // nền ở giữa khung, và phép thử ở tầng bảng kiểu không bắt được vì nó tự cấp
    // sẵn cặp (p, 1 - p).
    for (const frames of [1, 2, 8, 15, 30, 60]) {
      for (const durationInFrames of [frames, frames * 2, frames * 2 + 7, 300]) {
        for (let step = 0; step <= frames; step++) {
          const entering = enterProgressAt(step, frames)
          const leaving = exitProgressAt(durationInFrames - frames + step, frames, durationInFrames)
          expect(entering + leaving, `frames=${frames} khung=${step}`).toBeCloseTo(1, 10)
        }
      }
    }
  })

  it('kẹp hai đầu: ngoài quãng chuyển cảnh thì clip hiện hẳn', () => {
    expect(enterProgressAt(0, 15)).toBe(0)
    expect(enterProgressAt(15, 15)).toBe(1)
    expect(enterProgressAt(200, 15)).toBe(1)
    expect(exitProgressAt(0, 15, 90)).toBe(1)
    expect(exitProgressAt(75, 15, 90)).toBe(1)
    expect(exitProgressAt(90, 15, 90)).toBe(0)
  })

  it('không có chuyển cảnh thì clip hiện hẳn, không chia cho 0', () => {
    expect(enterProgressAt(0, 0)).toBe(1)
    expect(exitProgressAt(0, 0, 90)).toBe(1)
  })

  it('khung cuối của clip đi KHÔNG về 0, vì clip đến cũng chưa tới 1', () => {
    const frames = 15
    const duration = 90
    expect(exitProgressAt(duration - 1, frames, duration)).toBeCloseTo(1 / frames, 10)
    expect(enterProgressAt(frames - 1, frames)).toBeCloseTo((frames - 1) / frames, 10)
  })
})
