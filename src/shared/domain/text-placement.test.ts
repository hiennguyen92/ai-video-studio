import { describe, expect, it } from 'vitest'
import {
  alignmentToFlex,
  assPositionTag,
  clampTextPosition,
  dragTextPosition,
  pointerRotationDeg,
  textTransformOrigin
} from './text-placement'

describe('clampTextPosition', () => {
  it('giữ nguyên vị trí trong khung', () => {
    expect(clampTextPosition({ xPct: 0.3, yPct: 0.8 })).toEqual({ xPct: 0.3, yPct: 0.8 })
  })

  it('kẹp lại khi kéo ra ngoài khung', () => {
    // Thả chữ ra ngoài khung là mất hẳn: nó không vẽ ở đâu cả và cũng không còn
    // chỗ nào bấm vào để kéo về.
    expect(clampTextPosition({ xPct: -0.4, yPct: 1.9 })).toEqual({ xPct: 0, yPct: 1 })
  })
})

describe('textTransformOrigin', () => {
  it('neo theo alignment, vì ASS xoay quanh chính điểm neo đó', () => {
    // Đo bằng ffmpeg: xoay 30° thì alignment 5 giữ nguyên trọng tâm, còn
    // alignment 2 và 8 làm trọng tâm dịch về hai phía ngược nhau.
    expect(textTransformOrigin(2)).toBe('50% 100%')
    expect(textTransformOrigin(5)).toBe('50% 50%')
    expect(textTransformOrigin(8)).toBe('50% 0%')
    expect(textTransformOrigin(1)).toBe('0% 100%')
    expect(textTransformOrigin(9)).toBe('100% 0%')
  })

  it('vị trí tự do luôn neo tâm, khớp với `\\an5` lúc nung', () => {
    expect(textTransformOrigin(2, { xPct: 0.5, yPct: 0.2 })).toBe('50% 50%')
  })
})

describe('alignmentToFlex', () => {
  it('đổi đủ chín ô bàn phím số', () => {
    expect(alignmentToFlex(1)).toEqual({ vertical: 'flex-end', horizontal: 'flex-start' })
    expect(alignmentToFlex(5)).toEqual({ vertical: 'center', horizontal: 'center' })
    expect(alignmentToFlex(9)).toEqual({ vertical: 'flex-start', horizontal: 'flex-end' })
  })
})

describe('assPositionTag', () => {
  it('không đặt vị trí thì không thêm thẻ nào', () => {
    expect(assPositionTag(undefined, 1080, 1920)).toBe('')
  })

  it('đổi tỉ lệ sang pixel theo PlayRes, kèm `\\an5`', () => {
    // Thiếu `\an5` thì ASS đặt ĐIỂM NEO vào toạ độ đó chứ không đặt tâm, và chữ
    // lệch đi nửa khối so với bản xem trước.
    expect(assPositionTag({ xPct: 0.5, yPct: 0.25 }, 1080, 1920)).toBe('{\\an5\\pos(540,480)}')
  })

  it('làm tròn về số nguyên', () => {
    expect(assPositionTag({ xPct: 1 / 3, yPct: 1 / 3 }, 1000, 1000)).toBe('{\\an5\\pos(333,333)}')
  })
})

describe('dragTextPosition', () => {
  it('đổi quãng kéo pixel thành tỉ lệ theo cạnh tương ứng', () => {
    const next = dragTextPosition({ xPct: 0.5, yPct: 0.5 }, 80, -40, 800, 400)
    expect(next.xPct).toBeCloseTo(0.6)
    expect(next.yPct).toBeCloseTo(0.4)
  })

  it('kéo ra ngoài khung thì dừng ở mép', () => {
    expect(dragTextPosition({ xPct: 0.9, yPct: 0.5 }, 400, 0, 800, 400).xPct).toBe(1)
  })

  it('khung chưa đo được thì đứng yên thay vì cho ra NaN', () => {
    // NaN lọt vào style là chữ biến mất mà không có lỗi nào để lần theo.
    expect(dragTextPosition({ xPct: 0.5, yPct: 0.5 }, 10, 10, 0, 0)).toEqual({
      xPct: 0.5,
      yPct: 0.5
    })
  })
})

describe('pointerRotationDeg', () => {
  it('thẳng lên là 0 độ', () => {
    expect(pointerRotationDeg(100, 100, 100, 20)).toBe(0)
  })

  it('lệch sang phải là góc dương, xuôi chiều kim đồng hồ như CSS', () => {
    // Con trỏ ở trên-phải, cách tâm đúng 45°.
    expect(pointerRotationDeg(100, 100, 150, 50)).toBe(45)
  })

  it('lệch sang trái là góc âm', () => {
    expect(pointerRotationDeg(100, 100, 50, 50)).toBe(-45)
  })

  it('xoay được trọn vòng: dựng đứng, lộn ngược, và phía bên kia', () => {
    // Con trỏ ngay bên phải tâm = 90°, ngay bên dưới = 180°, bên trái = −90°.
    expect(pointerRotationDeg(100, 100, 180, 100)).toBe(90)
    expect(Math.abs(pointerRotationDeg(100, 100, 100, 180))).toBe(180)
    expect(pointerRotationDeg(100, 100, 20, 100)).toBe(-90)
  })

  it('nơi gọi vẫn kẹp hẹp hơn được', () => {
    expect(pointerRotationDeg(100, 100, 180, 100, 45)).toBe(45)
  })
})
