/**
 * Phần CSS của khung nền chữ.
 *
 * Tách khỏi `text-overlay-frame.tsx` vì file `.tsx` chỉ nên xuất component —
 * xuất kèm hàm thường làm fast refresh của dev server mất tác dụng cho cả file.
 */

import type { CSSProperties } from 'react'
import type {
  ResolvedImageTextFrame,
  ResolvedTextFrame,
  ResolvedVectorTextFrame
} from '../shared/domain/remotion-render-plan'
import {
  TEXT_FRAME_SLICE_PERCENT,
  buildFrameImageUri
} from '../shared/domain/text-frame-svg-builders'
import { textFramePngUrl } from './text-frame-png-urls'

/**
 * Bề dày viền, suy từ cỡ chữ.
 *
 * Phải theo cỡ chữ chứ không đặt cứng: viền 28px ôm vừa chữ 84px thì nuốt mất
 * chữ 24px. Cùng cách `padding` của khối chữ đang làm.
 */
export function frameBorderPx(frame: ResolvedVectorTextFrame, fontSizePx: number): number {
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
  return frame.kind === 'image'
    ? imageFrameBoxCss(frame, fontSizePx)
    : vectorFrameBoxCss(frame, fontSizePx)
}

function vectorFrameBoxCss(frame: ResolvedVectorTextFrame, fontSizePx: number): CSSProperties {
  const source = buildFrameImageUri(frame.style, frame.palette)
  if (!source) return {}

  return {
    position: 'relative',
    // KHÔNG dùng shorthand `border`: theo đặc tả, `border` ĐẶT LẠI `border-image`
    // về mặc định. Đổi khung là bề dày viền đổi, React ghi lại `border`, và nó
    // kéo `border-image-slice` về `100%` — trong khi chuỗi slice không đổi nên
    // React không ghi lại. Kết quả: khung mất sạch nét, chỉ còn nền phẳng.
    //
    // Bản xuất dựng DOM mới mỗi lần nên không dính; chỉ xem trước mới lộ, và chỉ
    // khi ĐỔI từ khung này sang khung khác.
    borderWidth: frameBorderPx(frame, fontSizePx),
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderImageSource: source,
    borderImageSlice: `${TEXT_FRAME_SLICE_PERCENT}% fill`,
    borderImageRepeat: frame.style.repeat,
    borderRadius: 0,
    /**
     * Nền cùng màu ruột khung, cắt theo hộp đệm.
     *
     * Không phải để trang trí — để BỊT MỐI NỐI. `border-image` vẽ chín ô rời
     * nhau; khi cả khối rơi vào nửa pixel thì mép các ô chừa lại vệt kẻ mảnh cho
     * nền phía sau lọt qua. Xảy ra ở hai đường: xem trước thu composition theo
     * tỉ lệ lẻ, và chữ ghim vị trí thì dời bằng `translate(-50%,-50%)`.
     *
     * `padding-box` là phần bắt buộc: cắt theo `border-box` thì nền tràn ra cả
     * dải viền và ló ra thành hình chữ nhật phía sau mép mây.
     */
    backgroundColor: frame.palette.fill,
    backgroundClip: 'padding-box',
    // Vẫn cần đệm dù dải viền đã chừa chỗ: ruột khung phủ kín hộp đệm, nên chữ
    // đặt sát mép sẽ chạm ngay vào nét trong của khung. Cùng tỉ lệ với nền hộp
    // phẳng đang dùng. Người dùng co giãn được theo từng chiều (`frame.padding`).
    padding: `${fontSizePx * 0.25 * frame.padding.y}px ${fontSizePx * 0.25 * frame.padding.x}px`
  }
}

/**
 * Hệ số đổi pixel ảnh khung gốc sang pixel trên khung hình.
 *
 * Ảnh khung vẽ trên ô 256px, góc 64px. Chữ 84px thì góc ra khoảng 54px — đủ lớn
 * để trang trí vẽ sẵn ở góc (mặt trời, vương miện, gáy lò xo) còn nhìn ra, mà
 * không nuốt mất chữ. Theo cỡ chữ chứ không đặt cứng, cùng lý do với khung vector.
 */
export function imageFrameScale(fontSizePx: number): number {
  return fontSizePx / 100
}

/** Bề dày viền (cũng là bề rộng góc) của khung ảnh, theo cỡ chữ. Số nguyên. */
export function imageFrameBorderPx(frame: ResolvedImageTextFrame, fontSizePx: number): number {
  return Math.round(frame.style.slicePx * imageFrameScale(fontSizePx))
}

/**
 * CSS của khung ẢNH: chỉ chừa chỗ, không vẽ gì.
 *
 * Hình khung do `TextFrameImageCanvas` vẽ lên một canvas phủ kín hộp viền, không
 * qua `border-image` — chín mảnh rời của CSS để lại vệt kẻ ở mép mảnh khi khối rơi
 * vào toạ độ lẻ, ở mọi độ đệm, đã thấy tận mắt trên xem trước. Ở đây chỉ còn:
 *
 * - viền trong suốt đúng bề dày góc, để chữ không lấn lên nét khung;
 * - đệm theo `frames.json`, nhân hệ số người dùng chỉnh;
 * - `isolation: isolate`, để canvas `z-index: -1` nằm trên nền của khối mà dưới
 *   chữ. Thiếu nó thì canvas chìm xuống sau cả footage.
 */
function imageFrameBoxCss(frame: ResolvedImageTextFrame, fontSizePx: number): CSSProperties {
  if (!textFramePngUrl(frame.style.id)) return {}

  const scale = imageFrameScale(fontSizePx)
  const { padding } = frame.style
  const { x, y } = frame.padding
  return {
    position: 'relative',
    borderWidth: imageFrameBorderPx(frame, fontSizePx),
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderRadius: 0,
    // Nền hộp phẳng (nếu style còn sót) không được lọt ra sau khung ảnh.
    backgroundColor: 'transparent',
    isolation: 'isolate',
    // Một chuỗi `padding` chứ không bốn thuộc tính rời: khối chữ đặt `padding`
    // dạng gộp ngay trước, và React cảnh báo lẫn vẽ sai khi gộp và rời trộn nhau
    // lúc đổi qua lại giữa nền hộp và khung.
    padding: [padding.top * y, padding.right * x, padding.bottom * y, padding.left * x]
      .map((value) => `${value * scale}px`)
      .join(' ')
  }
}

/**
 * Đệm MỘT bên ở hệ số 1, theo từng trục, tính bằng px composition.
 *
 * Để khung điều khiển trên xem trước đổi được quãng kéo chuột thành hệ số đệm.
 * Khung ảnh có đệm trên/dưới (hoặc trái/phải) khác nhau thì lấy trung bình hai
 * bên: mép kéo lệch con trỏ đôi chút là chấp nhận được, còn tách hai bên thì phải
 * lưu thêm hai hệ số nữa.
 */
export function frameBasePaddingPx(
  frame: ResolvedTextFrame,
  fontSizePx: number
): { x: number; y: number } {
  if (frame.kind === 'vector') {
    const side = fontSizePx * 0.25
    return { x: side, y: side }
  }
  const scale = imageFrameScale(fontSizePx)
  const { padding } = frame.style
  return {
    x: ((padding.left + padding.right) / 2) * scale,
    y: ((padding.top + padding.bottom) / 2) * scale
  }
}
