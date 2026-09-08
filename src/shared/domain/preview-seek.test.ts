import { describe, expect, it } from 'vitest'
import { previewSeekUs } from './preview-seek'

/**
 * Chỗ tua khi muốn XEM một khối chữ.
 *
 * Tua tới đúng mốc bắt đầu là rơi trúng khung duy nhất mà chữ vô hình: hiệu ứng
 * vào bắt đầu từ `opacity: 0`. Đo thật trên một dự án có sẵn — tại mốc bắt đầu
 * opacity bằng 0, nhích vào giữa thì bằng 1.
 */

describe('previewSeekUs', () => {
  it('không bao giờ dừng ở đúng mốc bắt đầu', () => {
    expect(previewSeekUs(1_000_000, 4_000_000)).toBeGreaterThan(1_000_000)
  })

  it('nhích đủ để qua hiệu ứng vào mặc định 0,35 giây', () => {
    // Khối dài bình thường: phải vượt 350ms, nếu không vẫn còn trong lúc mờ dần.
    expect(previewSeekUs(0, 3_000_000)).toBeGreaterThanOrEqual(350_000)
  })

  it('khối ngắn thì nhích ít, không rơi sang phần hiệu ứng ra', () => {
    // Nửa giây mà nhích 0,4 giây là chạm hiệu ứng ra, cũng đang mờ dần.
    const at = previewSeekUs(0, 500_000)
    expect(at).toBeLessThanOrEqual(500_000 / 3)
    expect(at).toBeGreaterThan(0)
  })

  it('luôn nằm trong khoảng của khối', () => {
    for (const [start, end] of [
      [0, 100_000],
      [2_000_000, 2_400_000],
      [5_000_000, 30_000_000]
    ]) {
      const at = previewSeekUs(start, end)
      expect(at).toBeGreaterThan(start)
      expect(at).toBeLessThan(end)
    }
  })

  it('khoảng rỗng hoặc ngược thì trả về chính mốc bắt đầu', () => {
    expect(previewSeekUs(1_000_000, 1_000_000)).toBe(1_000_000)
    expect(previewSeekUs(2_000_000, 1_000_000)).toBe(2_000_000)
  })
})
