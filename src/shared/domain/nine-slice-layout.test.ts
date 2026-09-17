import { describe, expect, it } from 'vitest'
import { layoutNineSlice, type NineSliceDraw } from './nine-slice-layout'

const base = {
  imageWidth: 256,
  imageHeight: 256,
  slicePx: 64,
  borderPx: 54,
  repeat: 'stretch' as const
}

/** Đếm số lần mỗi pixel canvas được vẽ. Khít nghĩa là đúng một lần, không hở không chồng. */
function coverage(draws: NineSliceDraw[], width: number, height: number): number[] {
  const hits = new Array<number>(width * height).fill(0)
  for (const draw of draws) {
    for (let y = draw.dy; y < draw.dy + draw.dh; y++) {
      for (let x = draw.dx; x < draw.dx + draw.dw; x++) hits[y * width + x] += 1
    }
  }
  return hits
}

describe('xếp mảnh 9-slice', () => {
  it('mọi pixel được vẽ đúng một lần — không hở, không chồng', () => {
    // Hở là lộ footage thành vệt tối, chồng là ruột hơi trong sáng lên thành vệt:
    // đúng hai kiểu vệt kẻ `border-image` để lại.
    for (const repeat of ['stretch', 'round'] as const) {
      for (const [width, height] of [
        [613, 187],
        [331, 140],
        [1000, 108]
      ]) {
        const draws = layoutNineSlice({ ...base, repeat, canvasWidth: width, canvasHeight: height })
        expect(coverage(draws, width, height).every((hit) => hit === 1)).toBe(true)
      }
    }
  })

  it('toạ độ đích đều là số nguyên', () => {
    const draws = layoutNineSlice({
      ...base,
      canvasWidth: 613.4,
      canvasHeight: 187.7,
      borderPx: 53.6
    })
    for (const draw of draws) {
      for (const value of [draw.dx, draw.dy, draw.dw, draw.dh]) {
        expect(Number.isInteger(value)).toBe(true)
      }
    }
  })

  it('góc giữ nguyên kích thước, cạnh giãn theo khối', () => {
    const draws = layoutNineSlice({ ...base, canvasWidth: 600, canvasHeight: 200 })
    const topLeft = draws.find((draw) => draw.dx === 0 && draw.dy === 0)!
    expect(topLeft).toMatchObject({ sx: 0, sy: 0, sw: 64, sh: 64, dw: 54, dh: 54 })
    expect(draws).toHaveLength(9)
  })

  it('round lát cạnh thành nhiều viên, ruột vẫn một viên', () => {
    const draws = layoutNineSlice({ ...base, repeat: 'round', canvasWidth: 600, canvasHeight: 200 })
    const topEdge = draws.filter((draw) => draw.dy === 0 && draw.sx === 64)
    // Cạnh dài 492px, viên tự nhiên 128 × 54/64 = 108px → 5 viên.
    expect(topEdge).toHaveLength(5)
    expect(draws.filter((draw) => draw.sx === 64 && draw.sy === 64)).toHaveLength(1)
  })

  it('khối nhỏ hơn hai góc thì thu góc lại, không để góc đè nhau', () => {
    const draws = layoutNineSlice({ ...base, canvasWidth: 80, canvasHeight: 60 })
    expect(coverage(draws, 80, 60).every((hit) => hit === 1)).toBe(true)
  })
})
