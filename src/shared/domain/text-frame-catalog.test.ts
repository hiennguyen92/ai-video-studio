import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFrameDecor,
  findTextFramePalette,
  findTextFrameStyle,
  type VectorTextFrameStyle
} from './text-frame-catalog'
import { IMAGE_TEXT_FRAME_FILES, normalizeHexColor } from './text-frame-image-styles'
import {
  buildBubbleTailImageUri,
  buildDecorImageUri,
  buildFrameImageUri
} from './text-frame-svg-builders'

const KHUNG_VECTOR = TEXT_FRAME_STYLES.filter(
  (style): style is VectorTextFrameStyle => style.kind === 'vector'
)
const KHUNG_ANH = TEXT_FRAME_STYLES.filter((style) => style.kind === 'image')

/** Mọi tổ hợp khung vector × bộ màu. Ma trận hữu hạn nên soi được hết, 5 × 6 = 30. */
const MOI_TO_HOP = KHUNG_VECTOR.flatMap((style) =>
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

  it('khung ảnh đọc đủ số đo từ frames.json', () => {
    expect(KHUNG_ANH.length).toBeGreaterThan(0)
    for (const style of KHUNG_ANH) {
      if (style.kind !== 'image') continue
      expect(style.slicePx).toBeGreaterThan(0)
      expect(style.textColor).toMatch(/^#[0-9A-F]{6}$/)
      // Thiếu tên tiếng Việt thì giao diện tiếng Việt lòi ra tên tiếng Anh.
      expect(style.nameVi).not.toBe(style.nameEn)
      expect(style.tags.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('mọi file khai trong frames.json đều có thật', () => {
    // Khai mà thiếu file thì bản dựng hỏng ở import, xa hẳn chỗ gây ra lỗi.
    for (const file of IMAGE_TEXT_FRAME_FILES) {
      expect(existsSync(join(__dirname, '..', '..', '..', 'resources', file))).toBe(true)
    }
  })

  it('màu ba chữ số được mở thành sáu', () => {
    expect(normalizeHexColor('#fff')).toBe('#FFFFFF')
    expect(normalizeHexColor('#3a2a4a')).toBe('#3A2A4A')
  })

  it('mọi khung vector đều dựng được hình', () => {
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
