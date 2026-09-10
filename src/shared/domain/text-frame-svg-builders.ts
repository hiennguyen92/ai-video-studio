/**
 * Dựng hình SVG cho khung nền chữ, trả về data URI dùng thẳng trong CSS.
 *
 * File này lo MÀU và cách bọc URI; dáng hình nằm ở `text-frame-svg-shapes`.
 *
 * HAI LUẬT BẤT BIẾN, cả hai đều có kiểm thử khẳng định:
 *
 * 1. **SVG phải thuần ASCII.** Không chữ tiếng Việt bên trong hình. Tên hiển thị
 *    nằm ở danh mục, không nằm trong SVG.
 * 2. **Luôn ghi cả `width`, `height` VÀ `viewBox`.** Nguồn SVG không có kích
 *    thước nội tại khi làm `border-image` là một lỗ hổng đặc tả chưa chốt, và
 *    `border-image-width: auto` cũng rơi về `border-width` khi thiếu.
 */

import type { TextFrameDecor, TextFramePalette, TextFrameStyle } from './text-frame-catalog'
import {
  TEXT_FRAME_VIEWBOX,
  cloudPath,
  roundedRect,
  sparkleEdges,
  star,
  tornPath,
  wobblyRect
} from './text-frame-svg-shapes'

export { TEXT_FRAME_VIEWBOX } from './text-frame-svg-shapes'

/**
 * Góc chiếm 40/120 đơn vị, tức 33,333%.
 *
 * Phơi ra ở đây vì lớp vẽ phải dùng đúng con số này cho `border-image-slice`. Đổi
 * một chỗ mà quên chỗ kia thì khung vẫn hiện, chỉ là cắt sai — kiểu hỏng âm thầm.
 */
export const TEXT_FRAME_SLICE_PERCENT = 33.333

const wrap = (size: number, inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
  `viewBox="0 0 ${size} ${size}">${inner}</svg>`

/**
 * Bọc thành `url(...)` cho CSS.
 *
 * `encodeURIComponent` chứ không base64: nó đổi `#` thành `%23` — một dấu `#`
 * chưa mã hoá CẮT CỤT data URI thành fragment, mà bảng màu của ta toàn `#RRGGBB`.
 * Nó cũng đổi `"` thành `%22` nên hết chuyện nháy lồng nhau. Và nó có y hệt nhau
 * ở cả Chromium của xem trước, Chrome Headless Shell của bản xuất lẫn Node lúc
 * chạy test — khác `btoa` (ném lỗi với ký tự ngoài Latin-1) và `Buffer` (không
 * tồn tại trong trình duyệt).
 *
 * Nháy kép bao ngoài là hợp lệ trong CSS và trong style object của React, nhưng
 * KHÔNG nhét thẳng vào thuộc tính `style="..."` của HTML được — chỗ đó nháy kép
 * cắt đứt thuộc tính và khung biến mất không kèm lỗi nào.
 */
const toCssUrl = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`

/**
 * Ruột khung: hình nào cũng phải tô kín ô giữa.
 *
 * Ô giữa (40..80 cả hai chiều) chính là phần `border-image-slice: … fill` lấy ra
 * làm nền sau chữ. Hình nào để hở ô đó thì chữ nằm trên nền trong suốt.
 */
function shape(d: string, palette: TextFramePalette, strokeWidth: number): string {
  return (
    `<path d="${d}" fill="${palette.fill}" stroke="${palette.stroke}" ` +
    `stroke-width="${strokeWidth}" stroke-linejoin="round"/>`
  )
}

/** Hình của từng kiểu khung. Tra theo id, thiếu thì lớp gọi tự bỏ khung đi. */
const BUILDERS: Record<string, (palette: TextFramePalette) => string> = {
  'bong-bong-thoai': (p) => shape(roundedRect(16, 26), p, 5),
  may: (p) => shape(cloudPath, p, 5),
  'giay-xe': (p) => shape(tornPath, p, 3),
  'vien-lap-lanh': (p) =>
    shape(roundedRect(24, 18), p, 4) + `<path d="${sparkleEdges()}" fill="${p.stroke}"/>`,
  'net-ve-tay': (p) =>
    // Nét MẢNH: nét dày cộng cạnh run đọc ra "sóng", không đọc ra "vẽ tay". Chất
    // vẽ tay nằm ở hai nét mảnh hụt nhau, không nằm ở biên độ run.
    shape(wobblyRect(20, 18), p, 3.5) +
    // Nét thứ hai run khác nét thứ nhất và hụt vào trong: một nét đơn nhìn ra
    // hình vẽ máy, hai nét chồng hụt nhau mới ra cảm giác vẽ tay.
    `<path d="${wobblyRect(27, 13)}" fill="none" stroke="${p.stroke}" stroke-width="2.4" ` +
    `stroke-opacity="0.65" stroke-linejoin="round"/>`
}

/** Khung chính, dùng làm `border-image-source`. */
export function buildFrameImageUri(
  style: TextFrameStyle,
  palette: TextFramePalette
): string | undefined {
  const build = BUILDERS[style.id]
  return build ? toCssUrl(wrap(TEXT_FRAME_VIEWBOX, build(palette))) : undefined
}

/**
 * Đuôi bong bóng thoại — vẽ RỜI, không nằm trong khung.
 *
 * `border-image` kéo hoặc lát cạnh dưới, nên một cái đuôi vẽ trong cạnh dưới sẽ
 * bị nhân lên thành cả hàng đuôi. Nó phải là một hình đặt tuyệt đối, đúng cơ chế
 * của điểm trang trí góc.
 *
 * Path để HỞ (không `Z`): phần tô vẫn khép kín ngầm, còn nét thì không vẽ cạnh
 * trên — cạnh đó úp vào thân bong bóng. Bản đầu bịt cạnh trên bằng một hình chữ
 * nhật cùng màu nền, và nó lộ ra thành một vệt cắt ngang.
 */
export function buildBubbleTailImageUri(palette: TextFramePalette): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="40" viewBox="0 0 48 40">` +
    `<path d="M6,3L26,36L42,3" fill="${palette.fill}" stroke="${palette.stroke}" ` +
    `stroke-width="5" stroke-linejoin="round"/></svg>`
  return toCssUrl(svg)
}

const DECOR_SHAPES: Record<string, (palette: TextFramePalette) => string> = {
  'ngoi-sao': (p) => `<path d="${star(24, 24, 20, 7)}" fill="${p.stroke}"/>`,
  'trai-tim': (p) =>
    `<path d="M24,42C10,30 4,23 4,16A11,11 0 0 1 24,10A11,11 0 0 1 44,16C44,23 38,30 24,42Z" ` +
    `fill="${p.stroke}"/>`,
  'tia-lap-lanh': (p) =>
    `<path d="${star(20, 20, 16, 4)}${star(37, 37, 9, 2.5)}" fill="${p.stroke}"/>`
}

/** Điểm trang trí đặt ở góc khung. */
export function buildDecorImageUri(
  decor: TextFrameDecor,
  palette: TextFramePalette
): string | undefined {
  const build = DECOR_SHAPES[decor.id]
  if (!build) return undefined
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">` +
    `${build(palette)}</svg>`
  return toCssUrl(svg)
}
