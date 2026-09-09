import { describe, expect, it } from 'vitest'
import { clipOffsetPx, fitInsideFrame } from './clip-frame-fit'

describe('fitInsideFrame', () => {
  const frame = { width: 1080, height: 1920 }

  it('ảnh ngang lấy trọn bề rộng', () => {
    expect(fitInsideFrame({ width: 1600, height: 900 }, frame)).toEqual({
      width: 1080,
      height: 607.5
    })
  })

  it('ảnh dọc lấy trọn chiều cao', () => {
    expect(fitInsideFrame({ width: 900, height: 1600 }, frame)).toEqual({
      width: 1080,
      height: 1920
    })
  })

  it('ảnh nhỏ hơn khung vẫn được phóng cho vừa', () => {
    // Bằng đúng cách `object-fit: contain` làm, để khung điều khiển bám khít ảnh.
    expect(fitInsideFrame({ width: 100, height: 100 }, frame)).toEqual({
      width: 1080,
      height: 1080
    })
  })

  it('thiếu số đo thì lấy trọn khung thay vì biến mất', () => {
    // Ảnh không probe được kích thước thà vẽ đầy khung còn hơn không vẽ gì.
    expect(fitInsideFrame(undefined, frame)).toEqual(frame)
    expect(fitInsideFrame({ width: 0, height: 0 }, frame)).toEqual(frame)
  })
})

describe('clipOffsetPx', () => {
  const frame = { width: 1000, height: 500 }

  it('0 là giữa khung', () => {
    expect(clipOffsetPx({ x: 0, y: 0 }, frame)).toEqual({ width: 0, height: 0 })
  })

  it('một đơn vị là NỬA khung, nên x = 1 đẩy tâm ra đúng mép', () => {
    // Trước đây lớp vẽ dùng thẳng con số này làm pixel: kéo hết thanh trượt chỉ
    // dịch được một pixel, và ô chỉnh coi như không có tác dụng.
    expect(clipOffsetPx({ x: 1, y: 1 }, frame)).toEqual({ width: 500, height: 250 })
    expect(clipOffsetPx({ x: -1, y: -0.5 }, frame)).toEqual({ width: -500, height: -125 })
  })
})
