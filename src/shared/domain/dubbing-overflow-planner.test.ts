import { describe, expect, it } from 'vitest'
import type { DubbingSegment } from './transcript-types'
import { DEFAULT_MAX_DUBBING_SPEED_UP } from './transcript-types'
import {
  planDubbingPlacement,
  planSegmentOverflow,
  totalTimelineExtensionUs
} from './dubbing-overflow-planner'

/**
 * Bất biến quan trọng nhất được kiểm ở đây: KHÔNG có đường nào dẫn tới việc audio
 * lồng tiếng bị cắt ngắn lại. Mọi ca tràn giờ đều phải kết thúc bằng "giữ nguyên
 * audio" hoặc "tăng tốc vừa đủ", không bao giờ bằng "bỏ bớt phần đuôi".
 */

function segment(overrides: Partial<DubbingSegment> = {}): DubbingSegment {
  return {
    id: 'dub_1',
    sourceSegmentId: 'seg_1',
    targetStartUs: 0,
    targetEndUs: 2_000_000,
    appliedSpeed: 1,
    status: 'ready',
    ...overrides
  }
}

describe('planSegmentOverflow', () => {
  it('audio vừa khít thì không có gì phải xử lý', () => {
    const plan = planSegmentOverflow(
      segment({ generatedDurationUs: 2_000_000 }),
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(plan.overflowUs).toBe(0)
    expect(plan.availableStrategies).toEqual([])
  })

  it('audio ngắn hơn khoảng gốc cũng không phải vấn đề', () => {
    const plan = planSegmentOverflow(
      segment({ generatedDurationUs: 1_200_000 }),
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(plan.overflowUs).toBe(0)
    expect(plan.requiredSpeed).toBeLessThan(1)
  })

  it('tràn ít thì tăng tốc là một lựa chọn', () => {
    // 2,4s cho khoảng 2s → cần 1,2x, vẫn dưới trần 1,3x.
    const plan = planSegmentOverflow(
      segment({ generatedDurationUs: 2_400_000 }),
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(plan.overflowUs).toBe(400_000)
    expect(plan.requiredSpeed).toBeCloseTo(1.2, 5)
    expect(plan.canSpeedUp).toBe(true)
    expect(plan.availableStrategies).toEqual(['speed-up', 'shorten-text', 'extend-timeline'])
  })

  it('tràn nhiều thì KHÔNG được đề xuất tăng tốc quá trần', () => {
    // 4s cho khoảng 2s → cần 2x, vượt xa 1,3x; nghe sẽ như tua nhanh.
    const plan = planSegmentOverflow(
      segment({ generatedDurationUs: 4_000_000 }),
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(plan.canSpeedUp).toBe(false)
    expect(plan.availableStrategies).toEqual(['shorten-text', 'extend-timeline'])
    // Không bao giờ có lựa chọn cắt bớt lời.
    expect(plan.availableStrategies).not.toContain('truncate')
  })

  it('đúng ngay tại trần vẫn cho phép tăng tốc', () => {
    const plan = planSegmentOverflow(segment({ generatedDurationUs: 2_600_000 }), 1.3)
    expect(plan.requiredSpeed).toBeCloseTo(1.3, 5)
    expect(plan.canSpeedUp).toBe(true)
  })

  it('chưa tạo audio thì chưa kết luận gì', () => {
    const plan = planSegmentOverflow(
      segment({ generatedDurationUs: undefined, status: 'pending' }),
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(plan.measured).toBe(false)
    expect(plan.availableStrategies).toEqual([])
  })
})

describe('planDubbingPlacement', () => {
  it('mọi đoạn vừa khít thì giữ nguyên vị trí gốc', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 1_800_000
        }),
        segment({
          id: 'b',
          targetStartUs: 2_000_000,
          targetEndUs: 4_000_000,
          generatedDurationUs: 1_900_000
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    expect(placed[0].startUs).toBe(0)
    expect(placed[1].startUs).toBe(2_000_000)
    expect(placed.every((item) => item.shiftedByUs === 0)).toBe(true)
  })

  it('tăng tốc làm audio khít đúng khoảng gốc, không đẩy đoạn sau', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 2_400_000,
          overflowStrategy: 'speed-up'
        }),
        segment({
          id: 'b',
          targetStartUs: 2_000_000,
          targetEndUs: 4_000_000,
          generatedDurationUs: 1_000_000
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    expect(placed[0].endUs).toBe(2_000_000)
    expect(placed[0].speed).toBeCloseTo(1.2, 5)
    // Đoạn sau không bị ảnh hưởng.
    expect(placed[1].startUs).toBe(2_000_000)
    expect(placed[1].shiftedByUs).toBe(0)
  })

  it('kéo dài timeline đẩy MỌI đoạn phía sau lùi đúng phần dôi ra', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 3_000_000,
          overflowStrategy: 'extend-timeline'
        }),
        segment({
          id: 'b',
          targetStartUs: 2_000_000,
          targetEndUs: 4_000_000,
          generatedDurationUs: 1_000_000
        }),
        segment({
          id: 'c',
          targetStartUs: 4_000_000,
          targetEndUs: 6_000_000,
          generatedDurationUs: 1_000_000
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    // Audio giữ nguyên độ dài thật.
    expect(placed[0].endUs).toBe(3_000_000)
    // Cả hai đoạn sau đều lùi 1 giây, không chỉ đoạn kế tiếp.
    expect(placed[1].startUs).toBe(3_000_000)
    expect(placed[2].startUs).toBe(5_000_000)
    expect(placed[2].shiftedByUs).toBe(1_000_000)
  })

  it('nhiều đoạn cùng kéo dài thì phần đẩy cộng dồn', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 3_000_000,
          overflowStrategy: 'extend-timeline'
        }),
        segment({
          id: 'b',
          targetStartUs: 2_000_000,
          targetEndUs: 4_000_000,
          generatedDurationUs: 2_500_000,
          overflowStrategy: 'extend-timeline'
        }),
        segment({
          id: 'c',
          targetStartUs: 4_000_000,
          targetEndUs: 6_000_000,
          generatedDurationUs: 500_000
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    // 1s từ đoạn a, thêm 0,5s từ đoạn b.
    expect(placed[2].shiftedByUs).toBe(1_500_000)
    expect(placed[2].startUs).toBe(5_500_000)
  })

  it('chưa chọn hướng thì GIỮ NGUYÊN audio đầy đủ và báo còn tràn', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 5_000_000
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    // Điểm mấu chốt: độ dài giữ đúng 5 giây, KHÔNG bị cắt về 2 giây.
    expect(placed[0].endUs - placed[0].startUs).toBe(5_000_000)
    expect(placed[0].speed).toBe(1)
    expect(placed[0].stillOverflowing).toBe(true)
  })

  it('chọn tăng tốc nhưng vượt trần thì không âm thầm tăng quá — vẫn báo còn tràn', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 6_000_000,
          overflowStrategy: 'speed-up'
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )

    expect(placed[0].speed).toBe(1)
    expect(placed[0].endUs - placed[0].startUs).toBe(6_000_000)
    expect(placed[0].stillOverflowing).toBe(true)
  })

  it('chọn rút ngắn lời mà chưa viết lại thì vẫn giữ nguyên audio', () => {
    const placed = planDubbingPlacement(
      [
        segment({
          id: 'a',
          targetStartUs: 0,
          targetEndUs: 2_000_000,
          generatedDurationUs: 3_000_000,
          overflowStrategy: 'shorten-text'
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(placed[0].endUs - placed[0].startUs).toBe(3_000_000)
    expect(placed[0].stillOverflowing).toBe(true)
  })

  it('sắp xếp theo thời gian gốc dù đầu vào lộn xộn', () => {
    const placed = planDubbingPlacement(
      [
        segment({ id: 'sau', targetStartUs: 4_000_000, targetEndUs: 6_000_000 }),
        segment({ id: 'truoc', targetStartUs: 0, targetEndUs: 2_000_000 })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    expect(placed.map((item) => item.segmentId)).toEqual(['truoc', 'sau'])
  })
})

describe('totalTimelineExtensionUs', () => {
  it('cộng phần dôi của mọi đoạn chọn kéo dài', () => {
    const total = totalTimelineExtensionUs(
      [
        segment({
          id: 'a',
          targetEndUs: 2_000_000,
          generatedDurationUs: 3_000_000,
          overflowStrategy: 'extend-timeline'
        }),
        segment({
          id: 'b',
          targetEndUs: 2_000_000,
          generatedDurationUs: 2_500_000,
          overflowStrategy: 'speed-up'
        })
      ],
      DEFAULT_MAX_DUBBING_SPEED_UP
    )
    // Chỉ đoạn chọn kéo dài mới tính vào.
    expect(total).toBe(1_000_000)
  })
})
