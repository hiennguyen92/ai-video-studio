import { describe, expect, it } from 'vitest'
import { volumeAtFrame } from './keyframe-volume-at'
import { resolveKeyframeTracks } from './keyframe-interpolation'
import type { Keyframe, KeyframeTracks, ResolvedKeyframeTracks } from './keyframe-types'

/**
 * Âm lượng theo thời gian.
 *
 * Điều phải giữ: mức của LANE luôn nhân vào, kể cả khi clip đang chạy keyframe.
 * Quên chỗ này thì một clip có keyframe bỗng nhiên bỏ qua thanh âm lượng ở đầu
 * lane — và chỉ nghe ra khi đã xuất file.
 */

const FPS = { num: 30, den: 1 }

function tracks(keyframes: Keyframe[]): ResolvedKeyframeTracks | undefined {
  return resolveKeyframeTracks({ volume: keyframes }, FPS, 0)
}

describe('âm lượng tại một khung hình', () => {
  it('không có keyframe thì là mức clip nhân mức lane', () => {
    expect(volumeAtFrame({ volume: 0.4, trackVolume: 0.5 }, 12)).toBeCloseTo(0.2, 5)
  })

  it('có keyframe thì keyframe thay mức CLIP, mức lane vẫn nhân vào', () => {
    const clip = {
      volume: 1,
      trackVolume: 0.5,
      keyframes: tracks([
        { atUs: 0, v: 1 },
        { atUs: 1_000_000, v: 0 }
      ])
    }
    expect(volumeAtFrame(clip, 0)).toBeCloseTo(0.5, 5)
    expect(volumeAtFrame(clip, 15)).toBeCloseTo(0.25, 5)
    expect(volumeAtFrame(clip, 30)).toBeCloseTo(0, 5)
  })

  it('lane tắt hẳn thì keyframe cũng không kéo tiếng lên được', () => {
    // Mức lane bằng 0 là lý do kế hoạch mang hai số riêng thay vì một tích: chia
    // ngược lại từ tích sẽ ra NaN đúng ở trường hợp này.
    const clip = {
      volume: 1,
      trackVolume: 0,
      keyframes: tracks([{ atUs: 0, v: 2 }])
    }
    expect(volumeAtFrame(clip, 0)).toBe(0)
  })

  it('keyframe của thuộc tính khác không đụng tới âm lượng', () => {
    const clip = {
      volume: 0.8,
      trackVolume: 1,
      keyframes: resolveKeyframeTracks(
        { 'transform.opacity': [{ atUs: 0, v: 0 }] } satisfies KeyframeTracks,
        FPS,
        0
      )
    }
    expect(volumeAtFrame(clip, 0)).toBeCloseTo(0.8, 5)
  })
})
