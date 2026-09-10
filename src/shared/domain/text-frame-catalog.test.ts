import { describe, expect, it } from 'vitest'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFrameDecor,
  findTextFramePalette,
  findTextFrameStyle
} from './text-frame-catalog'
import {
  buildBubbleTailImageUri,
  buildDecorImageUri,
  buildFrameImageUri
} from './text-frame-svg-builders'

/** Mọi tổ hợp khung × bộ màu. Ma trận hữu hạn nên soi được hết, 5 × 6 = 30. */
const MOI_TO_HOP = TEXT_FRAME_STYLES.flatMap((style) =>
  TEXT_FRAME_PALETTES.map((palette) => ({ style, palette }))
)

describe('danh mục khung nền chữ', () => {
  it('mọi id đều duy nhất', () => {
    const ids = [
      ...TEXT_FRAME_STYLES.map((item) => item.id),
      ...TEXT_FRAME_PALETTES.map((item) => item.id),
      ...TEXT_FRAME_DECORS.map((item) => item.id)
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('tra id lạ thì trả undefined chứ không ném', () => {
    // Id đọc lên từ file project của người dùng. Một id lạ — dự án cũ, bản app
    // khác — không đáng làm sập cả bản dựng.
    expect(findTextFrameStyle('khong-co')).toBeUndefined()
    expect(findTextFramePalette('khong-co')).toBeUndefined()
    expect(findTextFrameDecor('khong-co')).toBeUndefined()
  })

  it('tra id có thật thì trả đúng mục', () => {
    expect(findTextFrameStyle('may')?.nameVi).toBe('Mây')
    expect(findTextFramePalette('hong-phan')?.fill).toBe('#FFE3EF')
    expect(findTextFrameDecor('ngoi-sao')?.nameEn).toBe('Star')
  })

  it('mọi bộ màu đều cho chữ đọc được', () => {
    for (const palette of TEXT_FRAME_PALETTES) {
      expect(palette.text.toUpperCase()).not.toBe(palette.fill.toUpperCase())
      expect(palette.stroke.toUpperCase()).not.toBe(palette.fill.toUpperCase())
    }
  })

  it('mọi khung đều dựng được hình', () => {
    for (const { style, palette } of MOI_TO_HOP) {
      expect(buildFrameImageUri(style, palette)).toBeTruthy()
    }
  })

  it('mọi trang trí đều dựng được hình', () => {
    for (const decor of TEXT_FRAME_DECORS) {
      expect(buildDecorImageUri(decor, TEXT_FRAME_PALETTES[0])).toBeTruthy()
    }
  })
})

/**
 * Hai luật bất biến của SVG, rút ra từ phép đo trước khi xây.
 *
 * Cả hai đều là kiểu hỏng ÂM THẦM: khung không hiện ra, hoặc hiện sai, mà không
 * báo lỗi gì — và chỉ lộ ra khi đã xuất video.
 */
describe('luật bất biến của SVG khung', () => {
  const moiHinh = (): string[] => [
    ...MOI_TO_HOP.map(({ style, palette }) => buildFrameImageUri(style, palette) ?? ''),
    ...TEXT_FRAME_DECORS.map((decor) => buildDecorImageUri(decor, TEXT_FRAME_PALETTES[0]) ?? ''),
    ...TEXT_FRAME_PALETTES.map((palette) => buildBubbleTailImageUri(palette))
  ]

  it('không còn dấu # sống trong data URI', () => {
    // Một dấu `#` chưa mã hoá CẮT CỤT data URI thành fragment, mà bảng màu toàn
    // `#RRGGBB`. Khung sẽ biến mất, không kèm lỗi nào.
    for (const uri of moiHinh()) {
      expect(uri).not.toContain('#')
      expect(uri).toContain('%23')
    }
  })

  it('hình thuần ASCII, không lọt chữ tiếng Việt vào SVG', () => {
    for (const uri of moiHinh()) {
      const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1, -2))
      expect(svg).toMatch(/^[\x20-\x7E\s]*$/)
    }
  })

  it('hình nào cũng ghi đủ width, height và viewBox', () => {
    // Nguồn SVG không có kích thước nội tại khi làm `border-image` là một lỗ hổng
    // đặc tả chưa chốt, và `border-image-width: auto` cũng rơi về `border-width`.
    for (const uri of moiHinh()) {
      const svg = decodeURIComponent(uri.slice(uri.indexOf(',') + 1, -2))
      expect(svg).toMatch(/width="\d/)
      expect(svg).toMatch(/height="\d/)
      expect(svg).toMatch(/viewBox="0 0 \d/)
    }
  })

  it('hình nào cũng tô kín ruột để làm nền sau chữ', () => {
    for (const { style, palette } of MOI_TO_HOP) {
      const svg = decodeURIComponent(
        (buildFrameImageUri(style, palette) ?? '').slice(
          (buildFrameImageUri(style, palette) ?? '').indexOf(',') + 1,
          -2
        )
      )
      expect(svg).toContain(`fill="${palette.fill}"`)
    }
  })
})
