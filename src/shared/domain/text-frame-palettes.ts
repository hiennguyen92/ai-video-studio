/**
 * Bảng màu cho khung nền chữ.
 *
 * Ở file riêng vì nó là DỮ LIỆU thuần và dài, còn `text-frame-catalog` là chỗ mô
 * tả các kiểu khung. Thêm một bộ màu và thêm một kiểu khung là hai việc khác nhau.
 */

export interface TextFramePalette {
  id: string
  nameVi: string
  nameEn: string
  /** Nền, tức ruột khung — phần nằm ngay sau chữ. */
  fill: string
  /** Nét viền. Luôn đậm hơn nền, để khung còn thấy được trên footage sáng. */
  stroke: string
  /** Màu chữ đi kèm. Ba màu này phải đổi CÙNG nhau, xem `applyTextOverlayFrame`. */
  text: string
}

/**
 * Sáu bộ màu, mỗi bộ ba màu ăn khớp.
 *
 * Vì sao ĐỊNH SẴN chứ không cho chọn màu tự do: một khung cần ít nhất ba màu hợp
 * nhau. Một ô chọn màu không nói được cả ba; ba ô chọn màu thì mời người dùng
 * phối ra tổ hợp không đọc nổi. Repo đã kết luận đúng chuyện này ở
 * `applyTextOverlayBox` — nền, màu chữ và viền "phải đổi CÙNG nhau".
 *
 * Và ma trận kiểm thử hữu hạn: 5 × 6 = 30 tổ hợp, soi hết được. Màu tự do là vô
 * hạn, tức là không kiểm được cái nào.
 */
export const TEXT_FRAME_PALETTES: TextFramePalette[] = [
  {
    id: 'hong-phan',
    nameVi: 'Hồng phấn',
    nameEn: 'Blush pink',
    fill: '#FFE3EF',
    stroke: '#FF7BAC',
    text: '#7A2E4E'
  },
  {
    id: 'vang-kem',
    nameVi: 'Vàng kem',
    nameEn: 'Cream yellow',
    fill: '#FFF3D6',
    stroke: '#F5B942',
    text: '#6B4A12'
  },
  {
    id: 'xanh-mint',
    nameVi: 'Xanh mint',
    nameEn: 'Mint green',
    fill: '#DFF7EE',
    stroke: '#3FBF98',
    text: '#14523F'
  },
  {
    id: 'tim-lavender',
    nameVi: 'Tím lavender',
    nameEn: 'Lavender',
    fill: '#EFE6FF',
    stroke: '#9B7BE8',
    text: '#3E2A6B'
  },
  {
    id: 'xanh-troi',
    nameVi: 'Xanh trời',
    nameEn: 'Sky blue',
    fill: '#E1F0FF',
    stroke: '#4FA3F0',
    text: '#123C63'
  },
  {
    id: 'trang-kem',
    nameVi: 'Trắng kem',
    nameEn: 'Off white',
    fill: '#FFF8F0',
    stroke: '#C9B8A5',
    text: '#4A3B2C'
  }
]

/** Trả `undefined` khi không thấy, không ném: id đọc lên từ file project. */
export function findTextFramePalette(id: string): TextFramePalette | undefined {
  return TEXT_FRAME_PALETTES.find((item) => item.id === id)
}
