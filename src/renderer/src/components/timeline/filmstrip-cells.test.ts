import { describe, expect, it } from 'vitest'
import { filmstripCells, type FilmstripLayoutInput } from './filmstrip-cells'

/** Clip 4K DỌC dài 154 giây ở mức zoom mặc định — đúng ca người dùng kêu bị kéo dãn. */
const doc4k: FilmstripLayoutInput = {
  clipWidthPx: 154 * 60,
  pixelsPerSecond: 60,
  sourceInUs: 0,
  speed: 1,
  assetDurationUs: 154_000_000,
  frameCount: 40,
  sourceAspect: 2160 / 3840,
  trackHeightPx: 60
}

describe('bố trí ô filmstrip', () => {
  it('ô rộng đúng bằng khung hình đứng nguyên vẹn ở chiều cao track', () => {
    for (const input of [
      doc4k,
      // Clip NGANG ngắn: cách cũ bóp dẹt vì ô chỉ rộng 12px.
      { ...doc4k, clipWidthPx: 8 * 60, assetDurationUs: 8_000_000, sourceAspect: 16 / 9 },
      { ...doc4k, trackHeightPx: 110 },
      { ...doc4k, pixelsPerSecond: 6 }
    ]) {
      const cells = filmstripCells(input)
      expect(cells.length).toBeGreaterThan(0)
      const upright = input.trackHeightPx * (input.sourceAspect ?? 1)
      // Hẹp hơn thì khung méo; rộng hơn thì khung bị cắt thành lát mỏng.
      expect(cells[0].widthPx).toBeCloseTo(upright, 6)
    }
  })

  it('ô nối nhau không hở và phủ hết bề rộng clip', () => {
    const cells = filmstripCells(doc4k)
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].leftPx).toBeCloseTo(cells[index - 1].leftPx + cells[index - 1].widthPx, 6)
    }
    const last = cells[cells.length - 1]
    expect(last.leftPx + last.widthPx).toBeGreaterThanOrEqual(doc4k.clipWidthPx)
  })

  it('khung chạy tiến theo thời gian và không vượt số khung của sprite', () => {
    const cells = filmstripCells(doc4k)
    // Sprite chỉ có 40 khung mà clip cần nhiều ô hơn: khung lặp lại là ĐÚNG.
    expect(cells.length).toBeGreaterThan(doc4k.frameCount)
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].tileIndex).toBeGreaterThanOrEqual(cells[index - 1].tileIndex)
    }
    expect(cells[cells.length - 1].tileIndex).toBeLessThan(doc4k.frameCount)
    expect(cells[0].tileIndex).toBe(0)
  })

  it('clip đã cắt đầu bắt đầu từ khung giữa sprite, không phải khung 0', () => {
    // Bỏ nửa đầu: ô đầu tiên phải rơi vào khoảng khung thứ 20.
    const cells = filmstripCells({
      ...doc4k,
      sourceInUs: 77_000_000,
      clipWidthPx: 77 * 60
    })
    expect(cells[0].tileIndex).toBeGreaterThanOrEqual(19)
    expect(cells[0].tileIndex).toBeLessThanOrEqual(21)
  })

  it('clip chạy nhanh gấp đôi vẫn quét hết asset trên nửa bề rộng', () => {
    const cells = filmstripCells({ ...doc4k, speed: 2, clipWidthPx: 77 * 60 })
    expect(cells[cells.length - 1].tileIndex).toBe(doc4k.frameCount - 1)
  })

  it('zoom sâu vào clip dài không đẻ ra hàng ngàn thẻ div', () => {
    const cells = filmstripCells({ ...doc4k, pixelsPerSecond: 600, clipWidthPx: 154 * 600 })
    expect(cells.length).toBeLessThanOrEqual(400)
    // Chạm trần thì ô nới rộng ra chứ không bỏ trống phần cuối clip.
    const last = cells[cells.length - 1]
    expect(last.leftPx + last.widthPx).toBeGreaterThanOrEqual(154 * 600)
  })

  it('không có kích thước nguồn thì lùi về bước thời gian, không vỡ', () => {
    const cells = filmstripCells({ ...doc4k, sourceAspect: undefined })
    expect(cells).toHaveLength(40)
    expect(cells[0].widthPx).toBeCloseTo((154 * 60) / 40, 6)
  })

  it('clip rỗng hoặc chưa có sprite thì không vẽ gì', () => {
    expect(filmstripCells({ ...doc4k, clipWidthPx: 0 })).toEqual([])
    expect(filmstripCells({ ...doc4k, frameCount: 0 })).toEqual([])
    expect(filmstripCells({ ...doc4k, assetDurationUs: 0 })).toEqual([])
  })
})
