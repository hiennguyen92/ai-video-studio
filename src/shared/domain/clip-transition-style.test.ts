import { describe, expect, it } from 'vitest'
import { combineTransitionStyles, transitionStyleAt } from './clip-transition-style'
import { TRANSITION_KINDS, type TransitionKind } from './timeline-track-types'
import { GL_CSS_FALLBACK } from './clip-transition-gl'

describe('transitionStyleAt', () => {
  it('tiến độ 1 là hiện hẳn, và không để lại dấu vết CSS nào', () => {
    // `translateX(0%)` hay `blur(0px)` còn sót vẫn đẩy clip sang lớp vẽ riêng.
    expect(transitionStyleAt('fade', 1, 0)).toEqual({ opacity: 1 })
    expect(transitionStyleAt('slide-left', 1, 0)).toEqual({ opacity: 1 })
    expect(transitionStyleAt('wipe-left', 1, 0)).toEqual({ opacity: 1 })
    // Dưới 1 thì vẫn còn dịch chuyển: không phải cả quãng đều bị nuốt.
    expect(transitionStyleAt('slide-left', 0.8, 0).transform).toBe('translateX(3.2%)')
  })

  it('tên kiểu lạ không làm sập bản dựng', () => {
    // File dự án sửa tay hay chép từ bản mới hơn: nhánh switch rơi hết sẽ trả
    // `undefined`, và lớp vẽ nổ ngay khi đọc độ mờ.
    expect(transitionStyleAt('cong-trang-giay' as TransitionKind, 0.5, 0)).toEqual({
      opacity: 1
    })
  })

  it('tiến độ 0 là chưa hiện gì', () => {
    expect(transitionStyleAt('fade', 0, 0).opacity).toBe(0)
    expect(transitionStyleAt('slide-left', 0, 0).transform).toBe('translateX(100%)')
  })

  it('dùng CHUNG một bảng cho hiệu ứng ra, qua tiến độ chạy ngược và mép `out`', () => {
    // Viết hai bản công thức là mời chúng lệch nhau. Nhưng tiến độ ngược KHÔNG
    // đủ: kiểu có hướng còn phải đảo hướng, xem nhóm phép thử phía dưới.
    expect(transitionStyleAt('fade', 0.25, 0).opacity).toBe(0.25)
    expect(transitionStyleAt('slide-up', 0.5, 0).transform).toBe('translateY(50%)')
  })
})

describe('combineTransitionStyles', () => {
  it('không có hiệu ứng ra thì giữ nguyên hiệu ứng vào', () => {
    const enter = { opacity: 0.5, transform: 'scale(2)' }
    expect(combineTransitionStyles(enter, null)).toBe(enter)
  })

  it('độ mờ NHÂN vào nhau khi clip ngắn dính cả hai giai đoạn', () => {
    // Ghi đè sẽ làm clip bật về rõ hẳn rồi mới biến mất.
    const combined = combineTransitionStyles({ opacity: 0.5 }, { opacity: 0.4 })
    expect(combined.opacity).toBeCloseTo(0.2)
  })

  it('phép biến đổi và bộ lọc được nối lại, không đè nhau', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, transform: 'translateX(10%)', filter: 'blur(2px)' },
      { opacity: 1, transform: 'scale(0.5)', filter: 'brightness(2)' }
    )
    expect(combined.transform).toBe('translateX(10%) scale(0.5)')
    expect(combined.filter).toBe('blur(2px) brightness(2)')
  })

  it('phép cắt lấy của hiệu ứng RA, vì đó là thứ đang diễn ra sau cùng', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, clipPath: 'inset(0 0 0 10%)' },
      { opacity: 1, clipPath: 'inset(0 0 0 60%)' }
    )
    expect(combined.clipPath).toBe('inset(0 0 0 60%)')
  })
})

/** Con số đầu tiên trong một chuỗi CSS, để so hình học thay vì so chuỗi. */
function firstNumber(value: string | undefined): number {
  const found = /-?\d+(\.\d+)?/.exec(value ?? '')
  return found ? Number(found[0]) : NaN
}

/**
 * Các mốc phần trăm trong một gradient, theo thứ tự.
 *
 * Bắt riêng số có đuôi `%`: mã màu `#0000` cũng toàn chữ số, lấy "số đầu tiên"
 * là so 0 với 0 và phép thử tự dối mình.
 */
function percentStops(value: string | undefined): number[] {
  return ((value ?? '').match(/-?\d+(\.\d+)?%/g) ?? []).map(parseFloat)
}

/** Bốn cạnh của `inset(trên phải dưới trái)`, tính bằng phần trăm. */
function insetSides(clipPath: string | undefined): {
  right: number
  left: number
} {
  const numbers = (clipPath ?? '').match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  return { right: numbers[1] ?? NaN, left: numbers[3] ?? NaN }
}

describe('bất biến của mọi kiểu', () => {
  it('tiến độ 1 là hiện hẳn ở CẢ hai mép', () => {
    for (const kind of TRANSITION_KINDS) {
      for (const edge of ['in', 'out'] as const) {
        expect(transitionStyleAt(kind, 1, 0, edge).opacity, `${kind} ${edge}`).toBe(1)
      }
    }
  })

  it('ở tiến độ 1 không kiểu nào để lại dấu vết CSS', () => {
    for (const kind of TRANSITION_KINDS) {
      for (const edge of ['in', 'out'] as const) {
        expect(transitionStyleAt(kind, 1, 0, edge), `${kind} ${edge}`).toEqual({ opacity: 1 })
      }
    }
  })

  it('kiểu KHÔNG hướng cho ra kết quả y hệt ở hai mép', () => {
    for (const kind of ['fade', 'zoom', 'blur', 'flash', 'dip-to-black', 'rack-focus'] as const) {
      expect(transitionStyleAt(kind, 0.3, 5, 'out'), kind).toEqual(
        transitionStyleAt(kind, 0.3, 5, 'in')
      )
    }
  })
})

describe('clip đi rời sang phía ngược với clip đến', () => {
  // Trước đây hiệu ứng ra chỉ là hiệu ứng vào chạy ngược, nên hai clip cùng dồn
  // về một bên và để hở nền ở bên kia suốt chuyển cảnh.

  it('hai clip trượt dính nhau đúng một khung hình, không hở và không chồng', () => {
    for (const progress of [0.2, 0.5, 0.8]) {
      const entering = firstNumber(transitionStyleAt('slide-left', progress, 0, 'in').transform)
      const leaving = firstNumber(transitionStyleAt('slide-left', 1 - progress, 0, 'out').transform)
      expect(entering).toBeGreaterThan(0)
      expect(leaving).toBeLessThan(0)
      expect(entering - leaving).toBeCloseTo(100, 6)
    }
  })

  it('hai phép cắt của gạt bù nhau: cộng lại đúng một khung hình', () => {
    for (const progress of [0.2, 0.5, 0.8]) {
      // Clip đến giữ phần bên phải, clip đi giữ phần bên trái của CÙNG một mép.
      const entering = transitionStyleAt('wipe-left', progress, 0, 'in')
      const leaving = transitionStyleAt('wipe-left', 1 - progress, 0, 'out')
      expect(entering.clipPath).toMatch(/^inset\(0 0 0 /)
      expect(leaving.clipPath).toMatch(/^inset\(0 \d/)
      expect(insetSides(entering.clipPath).left + insetSides(leaving.clipPath).right).toBeCloseTo(
        100,
        6
      )
    }
  })

  it('hai mặt nạ mép mềm dừng ở CÙNG một mốc, chỉ đổi phần đặc với phần trong', () => {
    for (const progress of [0.25, 0.5, 0.75]) {
      const entering = transitionStyleAt('soft-wipe-left', progress, 0, 'in')
      const leaving = transitionStyleAt('soft-wipe-left', 1 - progress, 0, 'out')
      // Cùng mốc thì độ mờ của hai clip cộng lại đúng 1 ở mọi điểm trong dải mép.
      expect(percentStops(entering.maskImage)).toEqual(percentStops(leaving.maskImage))
      expect(percentStops(entering.maskImage)).toHaveLength(2)
      expect(entering.maskImage).toContain('#000 ')
      expect(leaving.maskImage).toContain('#0000 ')
    }
  })

  it('vệt sáng của line-wipe ở cùng một chỗ trên cả hai clip', () => {
    const entering = transitionStyleAt('line-wipe', 0.35, 0, 'in')
    const leaving = transitionStyleAt('line-wipe', 0.65, 0, 'out')
    expect(percentStops(leaving.overlay)).toEqual(percentStops(entering.overlay))
    expect(percentStops(entering.overlay)).toHaveLength(3)
  })
})

describe('kiểu không đối xứng', () => {
  it('punch-zoom: clip đi phóng vọt ra, clip đến nở từ nhỏ', () => {
    expect(firstNumber(transitionStyleAt('punch-zoom', 0.2, 0, 'in').transform)).toBeLessThan(1)
    // Tiến độ 0.2 ở mép ra nghĩa là gần cuối chuyển cảnh: lúc cú phóng đã bung.
    expect(firstNumber(transitionStyleAt('punch-zoom', 0.2, 0, 'out').transform)).toBeGreaterThan(1)
  })

  it('dip-to-black: cả hai phía đều tắt hẳn ở quãng giữa', () => {
    expect(transitionStyleAt('dip-to-black', 0.5, 0, 'in').opacity).toBe(0)
    expect(transitionStyleAt('dip-to-black', 0.5, 0, 'out').opacity).toBe(0)
  })

  it('impact: mạnh nhất ở giữa chuyển cảnh, tắt hẳn ở hai đầu', () => {
    const middle = firstNumber(transitionStyleAt('impact', 0.5, 3, 'in').filter)
    const nearEnd = firstNumber(transitionStyleAt('impact', 0.9, 3, 'in').filter)
    expect(middle).toBeGreaterThan(nearEnd)
    expect(transitionStyleAt('impact', 0.4, 0, 'in').opacity).toBe(0)
    expect(transitionStyleAt('impact', 0.6, 0, 'in').opacity).toBe(1)
  })
})

describe('kiểu WebGL có bản lùi CSS', () => {
  it('vẽ đúng bản lùi của nó khi hỏi tầng CSS', () => {
    // Lớp WebGL nằm ĐÈ lên hai clip và chỉ hiện khi vẽ xong. Máy không có WebGL2,
    // mất context, shader không biên dịch nổi — cả ba đều có thật — thì đây là
    // thứ người xem thấy, nên nó phải là một chuyển cảnh tử tế chứ không phải
    // một chỗ hổng.
    for (const [kind, fallback] of Object.entries(GL_CSS_FALLBACK)) {
      for (const progress of [0, 0.4, 0.8]) {
        expect(transitionStyleAt(kind as TransitionKind, progress, 3), kind).toEqual(
          transitionStyleAt(fallback, progress, 3)
        )
      }
    }
  })

  it('bản lùi cũng đảo hướng ở mép ra', () => {
    expect(transitionStyleAt('page-curl', 0.3, 0, 'out')).toEqual(
      transitionStyleAt('soft-wipe-left', 0.3, 0, 'out')
    )
  })
})

describe('gộp mặt nạ', () => {
  it('clip dính cả hai giai đoạn thì giữ CẢ hai mặt nạ và lấy phần giao', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, maskImage: 'linear-gradient(to left, #000 10%, #0000 22%)' },
      { opacity: 1, maskImage: 'linear-gradient(to right, #0000 60%, #000 72%)' }
    )
    expect(combined.maskImage).toBe(
      'linear-gradient(to left, #000 10%, #0000 22%), linear-gradient(to right, #0000 60%, #000 72%)'
    )
    expect(combined.maskComposite).toBe('intersect')
  })

  it('một mặt nạ thôi thì không cần luật gộp', () => {
    const combined = combineTransitionStyles(
      { opacity: 1, maskImage: 'linear-gradient(#000)' },
      {
        opacity: 1
      }
    )
    expect(combined.maskImage).toBe('linear-gradient(#000)')
    expect(combined.maskComposite).toBeUndefined()
  })
})
