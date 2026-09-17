import { describe, expect, it } from 'vitest'
import { clipSelectSeekUs } from './clip-select-seek'

const clip = { startUs: 2_000_000, durationUs: 3_000_000 }
const frame = 33_333

describe('tua đầu phát khi bấm chọn clip', () => {
  it('đầu phát ngoài clip thì tới đúng chỗ bấm', () => {
    expect(clipSelectSeekUs(clip, 3_250_000, 0, frame)).toBe(3_250_000)
    expect(clipSelectSeekUs(clip, 3_250_000, 9_000_000, frame)).toBe(3_250_000)
  })

  it('đầu phát đã trong clip thì giữ nguyên để không xô điểm cắt', () => {
    expect(clipSelectSeekUs(clip, 4_000_000, 2_500_000, frame)).toBeNull()
    expect(clipSelectSeekUs(clip, 4_000_000, 2_000_000, frame)).toBeNull()
  })

  it('đúng mép phải tính là ngoài clip; chỗ bấm kẹp trong clip, lùi một khung khỏi mép phải', () => {
    expect(clipSelectSeekUs(clip, 5_000_000, 5_000_000, frame)).toBe(5_000_000 - frame)
    expect(clipSelectSeekUs(clip, 1_000_000, 0, frame)).toBe(2_000_000)
  })
})
