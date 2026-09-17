/**
 * Khung nền chữ dựng từ ẢNH PNG: `resources/frames/*.png` kèm `frames.json`.
 *
 * Hình học (vùng cắt 9-slice, cách lát mép, đệm chữ, màu chữ) đọc thẳng từ
 * `frames.json` — đó là nơi duy nhất khai báo, chép sang đây thành bản thứ hai là
 * mời hai bản lệch nhau. File này chỉ bổ sung thứ JSON không có: tên tiếng Việt
 * và từ khoá cho agent chọn.
 *
 * Khác khung vector ở một chỗ quyết định: màu nằm CỨNG trong ảnh, nên khung ảnh
 * không có bộ màu và không có trang trí góc (nhiều ảnh đã vẽ sẵn trang trí).
 *
 * File không import URL ảnh: danh mục chạy cả ở tiến trình main và trong bài
 * test, nơi không có trình đóng gói nào biến `.png` thành URL. URL ảnh nằm ở
 * `src/remotion/text-frame-png-urls.ts`, chỉ lớp vẽ mới cần.
 */

import framesManifest from '../../../resources/frames/frames.json'
import type { TextFrameRepeat } from './text-frame-catalog'

export interface TextFramePadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface ImageTextFrameStyle {
  kind: 'image'
  /** Khoá bền, trùng tên file PNG. Dự án lưu id này. */
  id: string
  nameVi: string
  nameEn: string
  repeat: TextFrameRepeat
  /** Bề rộng góc cố định, tính bằng pixel của ẢNH GỐC. */
  slicePx: number
  /** Đệm thêm quanh chữ, bên trong viền, cũng tính bằng pixel ảnh gốc. */
  padding: TextFramePadding
  /** Màu chữ hợp với ruột khung, dạng `#RRGGBB`. */
  textColor: string
  tags: string[]
}

/** Tên tiếng Việt và từ khoá. Thiếu mục nào thì rơi về tên tiếng Anh, có test canh. */
const VIETNAMESE: Record<string, { nameVi: string; tags: string[] }> = {
  'confetti-party': { nameVi: 'Tiệc hoa giấy', tags: ['tiệc', 'hoa giấy', 'party', 'confetti'] },
  strawberry: { nameVi: 'Dâu tây', tags: ['dâu', 'trái cây', 'đỏ', 'strawberry'] },
  watermelon: { nameVi: 'Dưa hấu', tags: ['dưa hấu', 'mùa hè', 'trái cây', 'watermelon'] },
  'lemon-fresh': { nameVi: 'Chanh vàng', tags: ['chanh', 'tươi mát', 'vàng', 'lemon'] },
  'bubble-pop': { nameVi: 'Bong bóng màu', tags: ['bong bóng', 'nhiều màu', 'bubble', 'kẹo'] },
  'paw-prints': { nameVi: 'Dấu chân mèo', tags: ['thú cưng', 'mèo', 'chó', 'paw', 'pet'] },
  'music-notes': { nameVi: 'Nốt nhạc', tags: ['nhạc', 'nốt nhạc', 'music', 'bài hát'] },
  'donut-sprinkles': { nameVi: 'Bánh donut', tags: ['donut', 'bánh ngọt', 'hồng', 'sprinkles'] },
  'gingham-picnic': { nameVi: 'Khăn caro dã ngoại', tags: ['caro', 'dã ngoại', 'picnic', 'đỏ'] },
  'daisy-chain': { nameVi: 'Vòng hoa cúc', tags: ['hoa', 'hoa cúc', 'mùa xuân', 'daisy'] },
  'cloud-sun': { nameVi: 'Mây và mặt trời', tags: ['mây', 'mặt trời', 'nắng', 'sun'] },
  'moon-stars': { nameVi: 'Trăng sao', tags: ['trăng', 'sao', 'ban đêm', 'moon'] },
  'leafy-green': { nameVi: 'Lá xanh', tags: ['lá', 'thiên nhiên', 'xanh lá', 'leaf'] },
  'ribbon-bow': { nameVi: 'Nơ hồng', tags: ['nơ', 'quà', 'hồng', 'ribbon'] },
  'spiral-notebook': { nameVi: 'Sổ lò xo', tags: ['sổ tay', 'ghi chú', 'học tập', 'notebook'] },
  'royal-crown': { nameVi: 'Vương miện', tags: ['vương miện', 'nữ hoàng', 'VIP', 'crown'] },
  'winter-snow': { nameVi: 'Tuyết mùa đông', tags: ['tuyết', 'mùa đông', 'giáng sinh', 'snow'] },
  chalkboard: { nameVi: 'Bảng đen', tags: ['bảng đen', 'phấn', 'trường học', 'menu'] },
  'wood-sign': { nameVi: 'Biển gỗ', tags: ['gỗ', 'biển hiệu', 'mộc mạc', 'wood'] },
  'rainbow-cloud': { nameVi: 'Mây cầu vồng', tags: ['mây', 'cầu vồng', 'rainbow', 'cloud'] },
  'pop-burst': { nameVi: 'Nổ truyện tranh', tags: ['truyện tranh', 'bùm', 'nổi bật', 'comic'] },
  'sakura-pink': { nameVi: 'Hoa anh đào', tags: ['anh đào', 'sakura', 'hồng', 'hoa'] },
  'pastel-pink': { nameVi: 'Hồng pastel', tags: ['hồng', 'pastel', 'nhẹ nhàng', 'pink'] },
  'sticker-mint': { nameVi: 'Sticker bạc hà', tags: ['sticker', 'bạc hà', 'xanh mint', 'mint'] },
  'doodle-ink': { nameVi: 'Nét mực vẽ tay', tags: ['vẽ tay', 'nét mực', 'doodle', 'sketch'] },
  'polka-dots': { nameVi: 'Chấm bi', tags: ['chấm bi', 'hồng', 'polka', 'dễ thương'] },
  'candy-stripes': { nameVi: 'Kẹo sọc', tags: ['kẹo', 'sọc', 'hồng', 'candy'] },
  'neon-pink': { nameVi: 'Neon hồng', tags: ['neon', 'phát sáng', 'hồng', 'đêm'] },
  'neon-cyan': { nameVi: 'Neon xanh', tags: ['neon', 'phát sáng', 'xanh', 'đêm'] },
  'chat-bubble': { nameVi: 'Bong bóng chat', tags: ['bong bóng', 'thoại', 'chat', 'nói'] },
  'sticky-note': { nameVi: 'Giấy nhớ', tags: ['giấy nhớ', 'ghi chú', 'vàng', 'note'] },
  'kraft-tag': { nameVi: 'Thẻ giấy kraft', tags: ['giấy kraft', 'nhãn', 'thẻ', 'tag'] },
  'retro-pixel': { nameVi: 'Pixel cổ điển', tags: ['pixel', 'game', 'retro', '8-bit'] },
  'candy-gloss': { nameVi: 'Kẹo bóng', tags: ['kẹo', 'bóng', 'hồng đậm', 'nút bấm'] },
  'flower-corners': { nameVi: 'Góc hoa', tags: ['hoa', 'góc', 'xanh mint', 'flower'] },
  'heart-corners': { nameVi: 'Góc trái tim', tags: ['trái tim', 'tình yêu', 'hồng', 'heart'] },
  'frosted-glass': { nameVi: 'Kính mờ', tags: ['kính mờ', 'trong suốt', 'tối giản', 'glass'] },
  'comic-pop': { nameVi: 'Hộp truyện tranh', tags: ['truyện tranh', 'vàng', 'comic', 'đổ bóng'] },
  'cloud-puff': { nameVi: 'Mây bồng', tags: ['mây', 'bồng bềnh', 'xanh', 'cloud'] },
  'starry-night': { nameVi: 'Đêm sao', tags: ['sao', 'ban đêm', 'xanh đậm', 'star'] },
  'retro-double': { nameVi: 'Viền đôi cổ điển', tags: ['cổ điển', 'viền đôi', 'retro', 'kem'] },
  'rainbow-rim': { nameVi: 'Viền cầu vồng', tags: ['cầu vồng', 'nhiều màu', 'rainbow', 'viền'] }
}

/** `#fff` → `#FFFFFF`. Ô chọn màu và bộ xuất ASS chỉ hiểu dạng sáu chữ số. */
export function normalizeHexColor(value: string): string {
  const hex = value.replace('#', '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex
  return `#${full.toUpperCase()}`
}

export const IMAGE_TEXT_FRAME_STYLES: ImageTextFrameStyle[] = framesManifest.frames.map(
  (entry) => ({
    kind: 'image',
    id: entry.id,
    nameVi: VIETNAMESE[entry.id]?.nameVi ?? entry.name,
    nameEn: entry.name,
    repeat: entry.repeat === 'round' ? 'round' : 'stretch',
    slicePx: entry.slice,
    padding: entry.padding,
    textColor: normalizeHexColor(entry.textColor),
    tags: VIETNAMESE[entry.id]?.tags ?? [entry.name.toLowerCase()]
  })
)

/** Tên các khung có trong `frames.json`, để test đối chiếu với file PNG thật. */
export const IMAGE_TEXT_FRAME_FILES: string[] = framesManifest.frames.map((entry) => entry.file)
