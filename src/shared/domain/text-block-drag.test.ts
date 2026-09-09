import { describe, expect, it } from 'vitest'
import {
  MIN_TEXT_BLOCK_DURATION_US,
  applyTextBlockDrag,
  canDropTextBlock,
  textBlockRangeChanged,
  type TextBlockDragMode
} from './text-block-drag'

/**
 * Kéo khối chữ trên timeline.
 *
 * Điều cần chứng minh: KHÔNG có cách kéo nào sinh ra khoảng thời gian ngược hay
 * âm. Reducer từ chối những khoảng đó, nhưng nó từ chối im lặng — khối chỉ bật về
 * chỗ cũ và người dùng không hiểu vì sao. Kẹp ở đây thì lệnh phát ra luôn hợp lệ.
 */

const MODES: TextBlockDragMode[] = ['move', 'trim-start', 'trim-end']
const original = { startUs: 2_000_000, endUs: 5_000_000 }

describe('bất biến chung cho mọi kiểu kéo', () => {
  it('không bao giờ ra khoảng ngược, dù kéo tới đâu', () => {
    for (const mode of MODES) {
      for (const proposed of [-9_000_000, -1, 0, 1_999_999, 4_999_999, 5_000_001, 99_000_000]) {
        const next = applyTextBlockDrag(original, mode, proposed)
        expect(next.endUs, `${mode} @ ${proposed}`).toBeGreaterThan(next.startUs)
      }
    }
  })

  it('không bao giờ ra mốc bắt đầu âm', () => {
    for (const mode of MODES) {
      expect(applyTextBlockDrag(original, mode, -50_000_000).startUs).toBeGreaterThanOrEqual(0)
    }
  })

  it('luôn giữ được độ dài tối thiểu', () => {
    for (const mode of MODES) {
      for (const proposed of [-1, 2_000_000, 4_999_999, 5_000_000]) {
        const next = applyTextBlockDrag(original, mode, proposed)
        expect(next.endUs - next.startUs).toBeGreaterThanOrEqual(MIN_TEXT_BLOCK_DURATION_US)
      }
    }
  })

  it('làm tròn về số nguyên micro giây', () => {
    const next = applyTextBlockDrag(original, 'move', 1_234_567.89)
    expect(Number.isInteger(next.startUs)).toBe(true)
    expect(Number.isInteger(next.endUs)).toBe(true)
  })
})

describe('dời cả khối', () => {
  it('giữ nguyên độ dài', () => {
    const next = applyTextBlockDrag(original, 'move', 7_000_000)
    expect(next).toEqual({ startUs: 7_000_000, endUs: 10_000_000 })
  })

  it('kéo lùi quá mốc 0 thì dừng ở 0 mà KHÔNG cắt ngắn khối', () => {
    // Người dùng đang dời chứ không đang cắt; cắt ngắn ở đây là làm mất nội dung
    // mà họ không hề yêu cầu.
    const next = applyTextBlockDrag(original, 'move', -3_000_000)
    expect(next).toEqual({ startUs: 0, endUs: 3_000_000 })
  })
})

describe('kéo mép trái', () => {
  it('chỉ đổi mốc bắt đầu, mép phải đứng yên', () => {
    const next = applyTextBlockDrag(original, 'trim-start', 3_000_000)
    expect(next).toEqual({ startUs: 3_000_000, endUs: 5_000_000 })
  })

  it('kéo vượt qua mép phải thì dừng lại trước nó', () => {
    const next = applyTextBlockDrag(original, 'trim-start', 9_000_000)
    expect(next.endUs).toBe(5_000_000)
    expect(next.startUs).toBe(5_000_000 - MIN_TEXT_BLOCK_DURATION_US)
  })
})

describe('kéo mép phải', () => {
  it('chỉ đổi mốc kết thúc, mép trái đứng yên', () => {
    const next = applyTextBlockDrag(original, 'trim-end', 8_000_000)
    expect(next).toEqual({ startUs: 2_000_000, endUs: 8_000_000 })
  })

  it('kéo vượt qua mép trái thì dừng lại sau nó', () => {
    const next = applyTextBlockDrag(original, 'trim-end', -1_000_000)
    expect(next.startUs).toBe(2_000_000)
    expect(next.endUs).toBe(2_000_000 + MIN_TEXT_BLOCK_DURATION_US)
  })
})

describe('khối vốn đã ngắn hơn mức tối thiểu', () => {
  it('dời đi không làm nó ngắn thêm', () => {
    const tiny = { startUs: 1_000_000, endUs: 1_010_000 }
    const next = applyTextBlockDrag(tiny, 'move', 4_000_000)

    // Dữ liệu cũ có thể chứa khối ngắn hơn mức này; kéo nó không được làm hỏng thêm.
    expect(next.endUs - next.startUs).toBeGreaterThanOrEqual(MIN_TEXT_BLOCK_DURATION_US)
  })
})

describe('textBlockRangeChanged', () => {
  it('không đổi thì báo không đổi, để khỏi ghi một bước hoàn tác rỗng', () => {
    expect(textBlockRangeChanged(original, { ...original })).toBe(false)
  })

  it('đổi một đầu là tính đổi', () => {
    expect(textBlockRangeChanged(original, { ...original, endUs: 5_000_001 })).toBe(true)
    expect(textBlockRangeChanged(original, { ...original, startUs: 1_999_999 })).toBe(true)
  })
})

describe('canDropTextBlock', () => {
  const overlay = { kind: 'overlay' as const, overlayId: 'text_1' }
  const cue = { kind: 'subtitle' as const, subtitleTrackId: 'sub_1', cueId: 'cue_1' }

  it('chữ overlay chỉ thả được vào lane chữ', () => {
    expect(canDropTextBlock(overlay, { kind: 'text', locked: false })).toBe(true)
    expect(canDropTextBlock(overlay, { kind: 'video', locked: false })).toBe(false)
    expect(canDropTextBlock(overlay, { kind: 'audio', locked: false })).toBe(false)
    expect(canDropTextBlock(overlay, { kind: 'subtitle', locked: false })).toBe(false)
  })

  it('cue phụ đề chỉ thả được vào lane phụ đề ĐÃ gắn track', () => {
    expect(canDropTextBlock(cue, { kind: 'subtitle', locked: false, subtitleTrackId: 's' })).toBe(
      true
    )
    // Lane phụ đề rỗng chưa gắn track thì không có chỗ nào để đặt cue vào.
    expect(canDropTextBlock(cue, { kind: 'subtitle', locked: false })).toBe(false)
    expect(canDropTextBlock(cue, { kind: 'text', locked: false })).toBe(false)
  })

  it('lane bị khoá không nhận gì cả', () => {
    expect(canDropTextBlock(overlay, { kind: 'text', locked: true })).toBe(false)
    expect(canDropTextBlock(cue, { kind: 'subtitle', locked: true, subtitleTrackId: 's' })).toBe(
      false
    )
  })

  it('ngoài mọi lane thì không thả được', () => {
    // Lane ảo cũng rơi vào đây: nó không có track nào để tra ra, và cố tình
    // không cho thả vào — kéo nốt dòng cuối đi thì nó biến mất và không còn
    // đường quay lại.
    expect(canDropTextBlock(overlay, undefined)).toBe(false)
  })
})
