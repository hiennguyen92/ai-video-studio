import { describe, expect, it } from 'vitest'
import {
  NEUTRAL_MOTION_TRANSFORM,
  motionTransformAt,
  motionTransformCss,
  type ClipMotionKind
} from './clip-motion-types'

/**
 * Chuyển động trong clip.
 *
 * Điều cần chứng minh không phải "công thức chạy", mà là ba tính chất mà sai đi
 * thì hỏng theo kiểu KHÔNG ai nhìn ra ngay:
 *
 *   1. hàm thuần theo khung — cùng khung phải cho cùng kết quả, nếu không preview
 *      và bản xuất sẽ lệch nhau
 *   2. lia máy luôn kèm phóng nền — thiếu nó thì mép khung lộ ra thành viền đen
 *   3. cường độ 0 phải TRẢ VỀ ĐÚNG khung gốc, không phải "gần đúng"
 */

const ALL_KINDS: ClipMotionKind[] = [
  'zoom-in',
  'zoom-out',
  'pan-left',
  'pan-right',
  'pan-up',
  'pan-down',
  'punch-in',
  'shake'
]

describe('tính chất chung của mọi kiểu chuyển động', () => {
  it('cùng một khung luôn cho cùng một kết quả', () => {
    for (const kind of ALL_KINDS) {
      const motion = { kind, intensity: 0.7 }
      for (const frame of [0, 7, 42, 89]) {
        expect(motionTransformAt(motion, frame, 90)).toEqual(motionTransformAt(motion, frame, 90))
      }
    }
  })

  it('cường độ 0 trả về đúng khung gốc', () => {
    for (const kind of ALL_KINDS) {
      expect(motionTransformAt({ kind, intensity: 0 }, 30, 90)).toEqual(NEUTRAL_MOTION_TRANSFORM)
    }
  })

  it('không có chuyển động, hoặc clip rỗng, thì không đổi gì', () => {
    expect(motionTransformAt(undefined, 10, 90)).toEqual(NEUTRAL_MOTION_TRANSFORM)
    expect(motionTransformAt({ kind: 'zoom-in', intensity: 1 }, 10, 0)).toEqual(
      NEUTRAL_MOTION_TRANSFORM
    )
  })

  it('cường độ ngoài khoảng bị kẹp lại chứ không làm vỡ hình', () => {
    const huge = motionTransformAt({ kind: 'zoom-in', intensity: 99 }, 89, 90)
    const one = motionTransformAt({ kind: 'zoom-in', intensity: 1 }, 89, 90)

    expect(huge).toEqual(one)
    expect(motionTransformAt({ kind: 'zoom-in', intensity: -5 }, 89, 90)).toEqual(
      NEUTRAL_MOTION_TRANSFORM
    )
    expect(
      motionTransformAt({ kind: 'zoom-in', intensity: Number.NaN }, 89, 90).scale
    ).toBeGreaterThan(1)
  })

  it('không kiểu nào thu nhỏ khung xuống dưới 1 — thu nhỏ là lòi nền phía sau', () => {
    for (const kind of ALL_KINDS) {
      for (const frame of [0, 20, 45, 70, 89]) {
        expect(motionTransformAt({ kind, intensity: 1 }, frame, 90).scale).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('phóng', () => {
  it('zoom-in bắt đầu từ khung gốc rồi lớn dần', () => {
    const motion = { kind: 'zoom-in' as const, intensity: 1 }

    expect(motionTransformAt(motion, 0, 90).scale).toBe(1)
    expect(motionTransformAt(motion, 45, 90).scale).toBeGreaterThan(
      motionTransformAt(motion, 10, 90).scale
    )
    expect(motionTransformAt(motion, 89, 90).scale).toBeGreaterThan(1.1)
  })

  it('zoom-out đi ngược lại và kết thúc ở khung gốc', () => {
    const motion = { kind: 'zoom-out' as const, intensity: 1 }

    expect(motionTransformAt(motion, 0, 90).scale).toBeGreaterThan(1.1)
    expect(motionTransformAt(motion, 89, 90).scale).toBe(1)
  })

  it('cường độ lớn hơn thì phóng nhiều hơn', () => {
    const weak = motionTransformAt({ kind: 'zoom-in', intensity: 0.2 }, 89, 90).scale
    const strong = motionTransformAt({ kind: 'zoom-in', intensity: 1 }, 89, 90).scale

    expect(strong).toBeGreaterThan(weak)
  })
})

describe('lia máy', () => {
  it('luôn phóng nền, nếu không thì lộ mép khung thành viền đen', () => {
    for (const kind of ['pan-left', 'pan-right', 'pan-up', 'pan-down'] as ClipMotionKind[]) {
      const at = motionTransformAt({ kind, intensity: 1 }, 45, 90)
      expect(at.scale).toBeGreaterThan(1.1)
    }
  })

  it('biên độ lia không vượt phần dư mà phóng nền tạo ra', () => {
    // Phóng 1,14 tạo ra 7% dư mỗi bên. Lia quá mức đó là lộ mép.
    for (const kind of ['pan-left', 'pan-right', 'pan-up', 'pan-down'] as ClipMotionKind[]) {
      for (const frame of [0, 30, 60, 89]) {
        const at = motionTransformAt({ kind, intensity: 1 }, frame, 90)
        const margin = ((at.scale - 1) / 2) * 100
        expect(Math.abs(at.xPercent)).toBeLessThanOrEqual(margin)
        expect(Math.abs(at.yPercent)).toBeLessThanOrEqual(margin)
      }
    }
  })

  it('đi qua giữa khung ở chính giữa clip', () => {
    const at = motionTransformAt({ kind: 'pan-left', intensity: 1 }, 45, 91)
    expect(Math.abs(at.xPercent)).toBeLessThan(0.2)
  })

  it('hai hướng ngược nhau đi ngược chiều nhau', () => {
    const left = motionTransformAt({ kind: 'pan-left', intensity: 1 }, 0, 90).xPercent
    const right = motionTransformAt({ kind: 'pan-right', intensity: 1 }, 0, 90).xPercent

    expect(Math.sign(left)).toBe(-Math.sign(right))
  })

  it('lia dọc không làm dịch ngang và ngược lại', () => {
    expect(motionTransformAt({ kind: 'pan-up', intensity: 1 }, 20, 90).xPercent).toBe(0)
    expect(motionTransformAt({ kind: 'pan-left', intensity: 1 }, 20, 90).yPercent).toBe(0)
  })
})

describe('punch-in', () => {
  it('giật xong sớm rồi đứng yên tới hết clip', () => {
    const motion = { kind: 'punch-in' as const, intensity: 1 }

    expect(motionTransformAt(motion, 0, 90).scale).toBeGreaterThan(1.1)

    // Sau 30% clip phải gần như đã về khung gốc và không đổi nữa; kéo dài cả clip
    // thì nó thành zoom-out chậm, mất hẳn cảm giác nhấn.
    const settled = motionTransformAt(motion, 27, 90).scale
    const later = motionTransformAt(motion, 80, 90).scale
    expect(settled).toBeLessThan(1.01)
    expect(Math.abs(later - settled)).toBeLessThan(0.005)
  })
})

describe('rung', () => {
  it('đổi vị trí liên tục chứ không đứng yên', () => {
    const motion = { kind: 'shake' as const, intensity: 1 }
    const positions = [0, 1, 2, 3, 4].map((frame) => motionTransformAt(motion, frame, 90).xPercent)

    expect(new Set(positions).size).toBeGreaterThan(3)
  })

  it('rung quanh tâm chứ không trôi dần đi', () => {
    const motion = { kind: 'shake' as const, intensity: 1 }
    const samples = Array.from({ length: 120 }, (_, frame) => motionTransformAt(motion, frame, 120))
    const meanX = samples.reduce((total, at) => total + at.xPercent, 0) / samples.length

    // Trôi dần nghĩa là cuối clip khung hình lệch hẳn sang một bên.
    expect(Math.abs(meanX)).toBeLessThan(0.3)
  })
})

describe('motionTransformCss', () => {
  it('không có chuyển động thì không sinh transform thừa', () => {
    expect(motionTransformCss(NEUTRAL_MOTION_TRANSFORM)).toBe('')
  })

  it('sinh chuỗi CSS hợp lệ theo phần trăm và tỉ lệ', () => {
    const css = motionTransformCss({ scale: 1.1, xPercent: -2.5, yPercent: 1 })

    expect(css).toMatch(/^translate\(-2\.5000%, 1\.0000%\) scale\(1\.1000\)$/)
  })
})
