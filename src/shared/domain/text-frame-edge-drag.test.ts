import { describe, expect, it } from 'vitest'
import { textFrameEdgeAxis, textFramePaddingScaleFromEdgeDrag } from './text-frame-edge-drag'

const base = {
  startScale: 1,
  deltaXPx: 0,
  deltaYPx: 0,
  rotationDeg: 0,
  basePaddingPx: 40,
  // Xem trước thu composition còn một nửa: 40px đệm hiện ra 20px.
  screenPxPerCompositionPx: 0.5
}

describe('kéo mép khung đổi hệ số đệm', () => {
  it('mép phải kéo ra thì nới, kéo vào thì bó', () => {
    // Dời 20px màn hình = đúng một lần đệm mặc định → hệ số tăng 1.
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'right', deltaXPx: 20 })).toBe(2)
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'right', deltaXPx: -10 })).toBe(0.5)
  })

  it('mép trái và mép trên ngược chiều trục', () => {
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'left', deltaXPx: -20 })).toBe(2)
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'top', deltaYPx: -20 })).toBe(2)
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'bottom', deltaYPx: 20 })).toBe(2)
  })

  it('kéo theo trục kia không làm đổi đệm', () => {
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'right', deltaYPx: 50 })).toBe(1)
  })

  it('chữ xoay 90° thì mép phải của khối nằm phía dưới màn hình', () => {
    // Không chiếu lên trục của khối thì kéo mép khối đã xoay chẳng ăn thua gì.
    const next = textFramePaddingScaleFromEdgeDrag({
      ...base,
      edge: 'right',
      rotationDeg: 90,
      deltaYPx: 20
    })
    expect(next).toBeCloseTo(2)
  })

  it('kẹp trong khoảng 0–3', () => {
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'right', deltaXPx: -999 })).toBe(0)
    expect(textFramePaddingScaleFromEdgeDrag({ ...base, edge: 'right', deltaXPx: 999 })).toBe(3)
  })

  it('mép nào chỉnh trục nấy', () => {
    expect(textFrameEdgeAxis('left')).toBe('x')
    expect(textFrameEdgeAxis('bottom')).toBe('y')
  })
})
