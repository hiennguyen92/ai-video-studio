import { describe, expect, it } from 'vitest'
import { frameBoxCss } from './text-overlay-frame-css'
import { TEXT_FRAME_PALETTES, TEXT_FRAME_STYLES } from '../shared/domain/text-frame-catalog'

const frame = (id: string): Parameters<typeof frameBoxCss>[0] => ({
  style: TEXT_FRAME_STYLES.find((item) => item.id === id)!,
  palette: TEXT_FRAME_PALETTES[0]
})

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
    const css = frameBoxCss(frame('may'), 84) as Record<string, unknown>

    expect(css).not.toHaveProperty('border')
    expect(css.borderStyle).toBe('solid')
    expect(css.borderColor).toBe('transparent')
    expect(css.borderWidth).toBeGreaterThan(0)
  })

  it('không dùng shorthand nào khác có thể xoá border-image', () => {
    // `borderImage` và `background` cũng là shorthand đặt lại phần con của chúng.
    const css = frameBoxCss(frame('bong-bong-thoai'), 84) as Record<string, unknown>

    expect(css).not.toHaveProperty('borderImage')
    expect(css).not.toHaveProperty('background')
  })

  it('mọi khung đều ra đủ ba mảnh của border-image', () => {
    // Thiếu `fill` thì ruột khung rỗng và chữ nằm trần trên footage.
    for (const style of TEXT_FRAME_STYLES) {
      const css = frameBoxCss(frame(style.id), 84) as Record<string, unknown>
      expect(css.borderImageSource).toContain('data:image/svg+xml')
      expect(String(css.borderImageSlice)).toContain('fill')
      expect(css.borderImageRepeat).toBe(style.repeat)
    }
  })

  it('bề dày viền theo cỡ chữ, không đặt cứng', () => {
    const nho = frameBoxCss(frame('may'), 24) as Record<string, number>
    const to = frameBoxCss(frame('may'), 120) as Record<string, number>

    expect(to.borderWidth).toBeGreaterThan(nho.borderWidth)
  })
})
