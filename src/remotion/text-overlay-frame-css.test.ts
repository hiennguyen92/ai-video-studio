import { describe, expect, it } from 'vitest'
import { frameBoxCss, imageFrameScale } from './text-overlay-frame-css'
import { TEXT_FRAME_PNG_IDS } from './text-frame-png-urls'
import { TEXT_FRAME_PALETTES, TEXT_FRAME_STYLES } from '../shared/domain/text-frame-catalog'

const frame = (id: string, padding = { x: 1, y: 1 }): Parameters<typeof frameBoxCss>[0] => {
  const style = TEXT_FRAME_STYLES.find((item) => item.id === id)!
  return style.kind === 'image'
    ? { kind: 'image', style, padding }
    : { kind: 'vector', style, palette: TEXT_FRAME_PALETTES[0], padding }
}

/**
 * Cạm bẫy đã cắn một lần: shorthand `border` ĐẶT LẠI `border-image` về mặc định
 * theo đặc tả CSS.
 *
 * React chỉ ghi những thuộc tính ĐỔI giữa hai lần dựng. Đổi khung là bề dày viền
 * đổi nên `border` được ghi lại, kéo `border-image-slice` về `100%` — trong khi
 * chuỗi slice không đổi nên React không ghi lại. Khung mất sạch nét, chỉ còn nền
 * phẳng. Bản xuất dựng DOM mới mỗi lần nên không dính; chỉ xem trước mới lộ, và
 * chỉ khi ĐỔI từ khung này sang khung khác.
 */
describe('CSS của khung nền chữ', () => {
  it('KHÔNG dùng shorthand `border` — nó xoá mất border-image', () => {
    for (const id of ['may', 'sticky-note']) {
      const css = frameBoxCss(frame(id), 84) as Record<string, unknown>

      expect(css).not.toHaveProperty('border')
      expect(css.borderStyle).toBe('solid')
      expect(css.borderColor).toBe('transparent')
      expect(css.borderWidth).toBeGreaterThan(0)
    }
  })

  it('không dùng shorthand nào khác có thể xoá border-image', () => {
    // `borderImage` và `background` cũng là shorthand đặt lại phần con của chúng.
    for (const id of ['bong-bong-thoai', 'chat-bubble']) {
      const css = frameBoxCss(frame(id), 84) as Record<string, unknown>

      expect(css).not.toHaveProperty('borderImage')
      expect(css).not.toHaveProperty('background')
    }
  })

  it('mọi khung vector đều ra đủ ba mảnh của border-image', () => {
    // Thiếu `fill` thì ruột khung rỗng và chữ nằm trần trên footage.
    for (const style of TEXT_FRAME_STYLES.filter((item) => item.kind === 'vector')) {
      const css = frameBoxCss(frame(style.id), 84) as Record<string, unknown>
      expect(css.borderImageSource).toBeTruthy()
      expect(String(css.borderImageSlice)).toContain('fill')
      expect(css.borderImageRepeat).toBe(style.repeat)
    }
  })

  it('bề dày viền theo cỡ chữ, không đặt cứng', () => {
    for (const id of ['may', 'cloud-puff']) {
      const nho = frameBoxCss(frame(id), 24) as Record<string, number>
      const to = frameBoxCss(frame(id), 120) as Record<string, number>

      expect(to.borderWidth).toBeGreaterThan(nho.borderWidth)
    }
  })
})

describe('co giãn đệm khung', () => {
  it('đệm nhân theo hệ số từng chiều, viền giữ nguyên', () => {
    for (const id of ['may', 'chat-bubble']) {
      const mac = frameBoxCss(frame(id), 84) as Record<string, unknown>
      const sat = frameBoxCss(frame(id, { x: 0, y: 0 }), 84) as Record<string, unknown>
      const rong = frameBoxCss(frame(id, { x: 2, y: 1 }), 84) as Record<string, unknown>

      // Viền theo cỡ chữ: co giãn đệm mà làm đổi viền là nét vẽ lệch tỉ lệ.
      expect(sat.borderWidth).toBe(mac.borderWidth)
      expect(sat.padding).toBe('0px 0px' + (id === 'may' ? '' : ' 0px 0px'))
      const [top, right] = String(rong.padding).split(' ').map(parseFloat)
      const [macTop, macRight] = String(mac.padding).split(' ').map(parseFloat)
      expect(right).toBeCloseTo(macRight * 2)
      expect(top).toBeCloseTo(macTop)
    }
  })
})

describe('CSS của khung ảnh', () => {
  it('mọi khung ảnh trong danh mục đều có file PNG, và ngược lại', () => {
    // Thiếu ảnh thì lớp vẽ lặng lẽ bỏ khung — người dùng chọn rồi không thấy gì.
    const imageIds = TEXT_FRAME_STYLES.filter((style) => style.kind === 'image').map((s) => s.id)
    expect([...TEXT_FRAME_PNG_IDS].sort()).toEqual([...imageIds].sort())
  })

  it('KHÔNG dùng border-image — hình khung do canvas vẽ', () => {
    // `border-image` vẽ chín mảnh rời, để lại vệt kẻ ở mép mảnh trên xem trước.
    for (const style of TEXT_FRAME_STYLES.filter((item) => item.kind === 'image')) {
      const css = frameBoxCss(frame(style.id), 84) as Record<string, unknown>
      expect(css).not.toHaveProperty('borderImageSource')
      expect(css.borderColor).toBe('transparent')
      // Thiếu ngữ cảnh xếp lớp thì canvas `z-index: -1` chìm xuống sau footage.
      expect(css.isolation).toBe('isolate')
    }
  })

  it('viền và đệm co giãn cùng một tỉ lệ theo cỡ chữ', () => {
    const scale = imageFrameScale(84)
    const css = frameBoxCss(frame('chat-bubble'), 84) as Record<string, unknown>

    expect(css.borderWidth).toBe(Math.round(64 * scale))
    // Bong bóng chat chừa đáy rộng hơn cho cái đuôi — khai trong frames.json.
    expect(css.padding).toBe(`${28 * scale}px ${28 * scale}px ${48 * scale}px ${28 * scale}px`)
  })
})
