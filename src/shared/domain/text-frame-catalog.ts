/**
 * Danh mục khung nền dễ thương cho chữ overlay.
 *
 * Vì sao VẼ BẰNG SVG chứ không gom file ảnh: nhúng ảnh của người khác vào một app
 * đem phát hành là PHÁT HÀNH LẠI, chặt hơn hẳn dùng cá nhân, và mỗi file phải tự
 * kiểm giấy phép rồi giữ vết. Vẽ bằng mã thì không có giấy phép nào để kiểm,
 * không có blob nhị phân nào trong git, và mỗi khung là một hình đọc được — sửa
 * được, dựng lại được. Đây đúng cách thư viện hiệu ứng âm thanh đã chọn.
 *
 * Đổi lại: chỉ có những hình VECTOR vẽ nổi. Ảnh màu nước, texture giấy thật, ảnh
 * chụp — không dựng ra được, và cần một quyết định riêng về nguồn.
 *
 * Danh mục nằm ở `shared` vì ba nơi cùng đọc nó: lớp vẽ Remotion, giao diện, và
 * công cụ MCP cho agent. Chép làm ba bản là mời chúng lệch nhau.
 */

// Bảng màu nằm ở file riêng nhưng phơi lại qua đây: mọi nơi đang dùng chỉ cần
// biết một cửa vào duy nhất cho cả danh mục.
export {
  TEXT_FRAME_PALETTES,
  findTextFramePalette,
  type TextFramePalette
} from './text-frame-palettes'

/** Cách lát mép khi khung giãn ra. Góc thì KHÔNG bao giờ giãn, dù chọn cách nào. */
export type TextFrameRepeat = 'round' | 'stretch'

export interface TextFrameStyle {
  /** Khoá bền: dự án lưu id này, KHÔNG lưu SVG và KHÔNG lưu màu. */
  id: string
  nameVi: string
  nameEn: string
  repeat: TextFrameRepeat
  /**
   * Bề dày viền, tính theo cỡ chữ.
   *
   * Phải theo cỡ chữ chứ không đặt cứng: viền 28px ôm vừa chữ 84px thì nuốt mất
   * chữ 24px. Mỗi khung một tỉ lệ vì nét vẽ dày mỏng khác nhau.
   */
  borderRatio: number
  /** Có đuôi bong bóng thoại không. Đuôi vẽ rời, xem `text-frame-svg-builders`. */
  hasTail?: boolean
  /** Từ khoá cho agent chọn. Chính chúng ta viết, nên agent chọn theo chữ vẫn trúng. */
  tags: string[]
}

export interface TextFrameDecor {
  id: string
  nameVi: string
  nameEn: string
  tags: string[]
}

/**
 * Năm khung, không phải năm mươi.
 *
 * Con số là có chủ ý, giống danh mục âm thanh: năm cái dùng được hơn năm mươi cái
 * phải lục. Thêm một cái thì nên bỏ một cái.
 */
export const TEXT_FRAME_STYLES: TextFrameStyle[] = [
  {
    id: 'bong-bong-thoai',
    nameVi: 'Bong bóng thoại',
    nameEn: 'Speech bubble',
    // `stretch` chứ không `round`: bong bóng là hình trơn, lát gạch mép trơn chỉ
    // tốn công mà nhìn y hệt.
    repeat: 'stretch',
    borderRatio: 0.34,
    hasTail: true,
    tags: ['bong bóng', 'thoại', 'nói', 'bubble', 'speech', 'chat']
  },
  {
    id: 'may',
    nameVi: 'Mây',
    nameEn: 'Cloud',
    repeat: 'round',
    borderRatio: 0.38,
    tags: ['mây', 'bồng bềnh', 'tròn', 'cloud', 'puffy', 'cute']
  },
  {
    id: 'giay-xe',
    nameVi: 'Giấy xé',
    nameEn: 'Torn paper',
    repeat: 'round',
    // Dày hơn các khung khác: răng xé cần chỗ, viền mỏng thì răng teo lại thành
    // nét lông xù.
    borderRatio: 0.36,
    tags: ['giấy', 'xé', 'rách', 'paper', 'torn', 'scrapbook']
  },
  {
    id: 'vien-lap-lanh',
    nameVi: 'Viền lấp lánh',
    nameEn: 'Sparkle border',
    repeat: 'round',
    borderRatio: 0.34,
    tags: ['lấp lánh', 'sao', 'long lanh', 'sparkle', 'star', 'glitter']
  },
  {
    id: 'net-ve-tay',
    nameVi: 'Nét vẽ tay',
    nameEn: 'Hand-drawn',
    repeat: 'round',
    borderRatio: 0.34,
    tags: ['vẽ tay', 'nguệch ngoạc', 'sketch', 'hand-drawn', 'doodle']
  }
]

/** Điểm trang trí ở góc khung. Bỏ trống nghĩa là không có. */
export const TEXT_FRAME_DECORS: TextFrameDecor[] = [
  {
    id: 'ngoi-sao',
    nameVi: 'Ngôi sao',
    nameEn: 'Star',
    tags: ['sao', 'star', 'ngôi sao']
  },
  {
    id: 'trai-tim',
    nameVi: 'Trái tim',
    nameEn: 'Heart',
    tags: ['tim', 'trái tim', 'heart', 'love']
  },
  {
    id: 'tia-lap-lanh',
    nameVi: 'Tia lấp lánh',
    nameEn: 'Sparkle',
    tags: ['lấp lánh', 'tia', 'sparkle', 'shine']
  }
]

// Ba hàm tra dưới đây trả `undefined` khi không thấy, KHÔNG ném lỗi: id đọc lên từ
// file project của người dùng, và một id lạ (project cũ, bản app khác) không đáng
// làm sập cả bản dựng — lớp vẽ chỉ cần bỏ khung đi.

export function findTextFrameStyle(id: string): TextFrameStyle | undefined {
  return TEXT_FRAME_STYLES.find((item) => item.id === id)
}

export function findTextFrameDecor(id: string): TextFrameDecor | undefined {
  return TEXT_FRAME_DECORS.find((item) => item.id === id)
}
