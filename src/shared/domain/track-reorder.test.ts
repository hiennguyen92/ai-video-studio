import { describe, expect, it } from 'vitest'
import { insertionSlot, reorderChangesOrder, reorderToIndex } from './track-reorder'

/** Bốn hàng cao 100px, xếp từ y = 0. */
const rows = [
  { top: 0, bottom: 100 },
  { top: 100, bottom: 200 },
  { top: 200, bottom: 300 },
  { top: 300, bottom: 400 }
]

describe('insertionSlot', () => {
  it('trên nửa đầu hàng đầu thì chèn trước tất cả', () => {
    expect(insertionSlot(10, rows)).toBe(0)
    expect(insertionSlot(-50, rows)).toBe(0)
  })

  it('mốc là GIỮA hàng, không phải mép', () => {
    // Dùng mép thì hàng chỉ đổi chỗ khi kéo vượt hẳn qua một hàng, và cảm giác
    // là nó dính.
    expect(insertionSlot(49, rows)).toBe(0)
    expect(insertionSlot(51, rows)).toBe(1)
    expect(insertionSlot(149, rows)).toBe(1)
    expect(insertionSlot(151, rows)).toBe(2)
  })

  it('dưới hàng cuối thì chèn sau tất cả', () => {
    expect(insertionSlot(390, rows)).toBe(4)
    expect(insertionSlot(9999, rows)).toBe(4)
  })

  it('không có hàng nào thì khe duy nhất là 0', () => {
    expect(insertionSlot(100, [])).toBe(0)
  })
})

describe('reorderToIndex', () => {
  it('khe nằm TRƯỚC vị trí cũ thì giữ nguyên', () => {
    expect(reorderToIndex(0, 2)).toBe(0)
    expect(reorderToIndex(2, 2)).toBe(2)
  })

  it('khe nằm SAU vị trí cũ thì tụt một, vì lane đã bị gỡ ra trước khi chèn', () => {
    // Lệnh `track/reorder` splice ra rồi mới splice vào; quên trừ một là lane
    // nhảy quá một hàng và người dùng thấy nó "không chịu vào đúng chỗ".
    expect(reorderToIndex(3, 1)).toBe(2)
    expect(reorderToIndex(4, 0)).toBe(3)
  })
})

describe('reorderChangesOrder', () => {
  it('thả ngay trên hoặc ngay dưới chính nó là không đổi gì', () => {
    expect(reorderChangesOrder(2, 2)).toBe(false)
    expect(reorderChangesOrder(3, 2)).toBe(false)
  })

  it('thả sang khe khác thì có đổi', () => {
    expect(reorderChangesOrder(0, 2)).toBe(true)
    expect(reorderChangesOrder(4, 2)).toBe(true)
  })
})
