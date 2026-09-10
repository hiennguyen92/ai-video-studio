/**
 * Phần CSS của khung nền chữ.
 *
 * Tách khỏi `text-overlay-frame.tsx` vì file `.tsx` chỉ nên xuất component —
 * xuất kèm hàm thường làm fast refresh của dev server mất tác dụng cho cả file.
 */

import type { CSSProperties } from 'react'
import type { ResolvedTextFrame } from '../shared/domain/remotion-render-plan'
import {
  TEXT_FRAME_SLICE_PERCENT,
  buildFrameImageUri
} from '../shared/domain/text-frame-svg-builders'

/**
 * Bề dày viền, suy từ cỡ chữ.
 *
 * Phải theo cỡ chữ chứ không đặt cứng: viền 28px ôm vừa chữ 84px thì nuốt mất
 * chữ 24px. Cùng cách `padding` của khối chữ đang làm.
 */
export function frameBorderPx(frame: ResolvedTextFrame, fontSizePx: number): number {
  return Math.round(fontSizePx * frame.style.borderRatio)
}

/**
 * Phần CSS đặt lên chính khối chữ.
 *
 * Bốn điểm không được quên, cả bốn đều là kiểu hỏng ÂM THẦM:
 *
 * 1. **Phải có `border-width` và `border-style` thật.** Một số trình duyệt không
 *    vẽ border-image khi `border-style: none` hoặc `border-width: 0`. Nên
 *    `solid transparent`.
 * 2. **`fill` trong `border-image-slice`** mới vẽ ô GIỮA, tức là nền sau chữ.
 *    Thiếu nó thì được cái khung rỗng ruột, chữ vẫn nằm trần trên footage.
 * 3. **Slice theo PHẦN TRĂM**, không theo số: với nguồn vector, `<number>` tính
 *    theo kích thước phần tử chứ không theo ảnh nguồn.
 * 4. **`border-radius` vô tác dụng lên border-image.** Góc bo nằm sẵn trong SVG,
 *    nên phải trả `borderRadius: 0` để không sót giá trị của nền hộp phẳng.
 *
 * KHÔNG dùng `border-image-outset`: khung điều khiển kéo-thả trên preview đo khối
 * chữ bằng `getBoundingClientRect()`, mà phép đo đó tính `border` nhưng KHÔNG
 * tính `outset` — phần khung tràn ra sẽ nằm ngoài khung điều khiển và kéo trượt
 * tay. Cần thêm chỗ thì tăng bề dày viền.
 */
export function frameBoxCss(frame: ResolvedTextFrame, fontSizePx: number): CSSProperties {
  const source = buildFrameImageUri(frame.style, frame.palette)
  if (!source) return {}

  return {
    position: 'relative',
    border: `${frameBorderPx(frame, fontSizePx)}px solid transparent`,
    borderImageSource: source,
    borderImageSlice: `${TEXT_FRAME_SLICE_PERCENT}% fill`,
    borderImageRepeat: frame.style.repeat,
    borderRadius: 0,
    /**
     * Nền cùng màu ruột khung, cắt theo hộp đệm.
     *
     * Không phải để trang trí — để BỊT MỐI NỐI. `border-image` vẽ chín ô rời
     * nhau; khi cả khối bị thu nhỏ theo tỉ lệ LẺ, mép các ô rơi vào giữa pixel và
     * chừa lại vệt kẻ mảnh cho nền phía sau lọt qua. Bản xuất vẽ 1:1 nên sạch,
     * còn xem trước thì luôn thu composition cho vừa khung — nên vệt kẻ chỉ hiện
     * ở xem trước, và hiện thành một cái lưới chạy ngang qua chữ.
     *
     * `padding-box` là phần bắt buộc: cắt theo `border-box` thì nền tràn ra cả
     * dải viền và ló ra thành hình chữ nhật phía sau mép mây.
     */
    backgroundColor: frame.palette.fill,
    backgroundClip: 'padding-box',
    // Vẫn cần đệm dù dải viền đã chừa chỗ: ruột khung phủ kín hộp đệm, nên chữ
    // đặt sát mép sẽ chạm ngay vào nét trong của khung. Cùng tỉ lệ với nền hộp
    // phẳng đang dùng.
    padding: fontSizePx * 0.25
  }
}
