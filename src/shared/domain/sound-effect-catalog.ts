import type { Micros } from './time-units'

/**
 * Thư viện hiệu ứng âm thanh dựng sẵn trong app.
 *
 * Vì sao TỔNG HỢP chứ không gom file có sẵn: nhúng âm thanh của người khác vào
 * một app đem phát hành là PHÁT HÀNH LẠI, chặt hơn hẳn dùng cá nhân, và mỗi file
 * phải tự kiểm giấy phép rồi giữ vết. Tổng hợp thì không có giấy phép nào để
 * kiểm, không có blob nhị phân nào trong git, và mỗi hiệu ứng là một công thức
 * đọc được — sửa được, dựng lại được, không phải một file ai đó tải về từ đâu.
 *
 * Đổi lại: bảng màu này chỉ có hiệu ứng TRỪU TƯỢNG. Tiếng máy tính tiền, tiếng
 * giấy, tiếng vỗ tay là thu thật, không tổng hợp ra được, và cần một quyết định
 * riêng về nguồn.
 *
 * Danh mục nằm ở `shared` vì ba nơi cùng đọc nó: script dựng file lúc build,
 * giao diện, và công cụ MCP cho agent. Chép làm ba bản là mời chúng lệch nhau.
 */

export type SoundEffectCategory = 'transition' | 'accent' | 'impact' | 'ui'

export interface SoundEffectDefinition {
  /** Khoá bền: dự án lưu id này, KHÔNG lưu đường dẫn. */
  id: string
  nameVi: string
  nameEn: string
  category: SoundEffectCategory
  durationUs: Micros
  /** Từ khoá cho agent chọn. Chính chúng ta viết, nên agent chọn theo chữ vẫn trúng. */
  tags: string[]
}

const ms = (value: number): Micros => value * 1000

/**
 * Mười hai hiệu ứng, không phải hai trăm.
 *
 * Con số này là có chủ ý: hai mươi lăm cái dùng được hơn hai trăm cái phải lục.
 * Thêm một cái thì nên bỏ một cái.
 */
export const SOUND_EFFECTS: SoundEffectDefinition[] = [
  {
    id: 'whoosh-fast',
    nameVi: 'Vụt nhanh',
    nameEn: 'Fast whoosh',
    category: 'transition',
    durationUs: ms(400),
    tags: ['chuyển cảnh', 'vụt', 'whoosh', 'transition', 'swipe']
  },
  {
    id: 'whoosh-soft',
    nameVi: 'Vụt nhẹ',
    nameEn: 'Soft whoosh',
    category: 'transition',
    durationUs: ms(700),
    tags: ['chuyển cảnh', 'nhẹ', 'whoosh', 'transition']
  },
  {
    id: 'swipe-up',
    nameVi: 'Lướt lên',
    nameEn: 'Swipe up',
    category: 'transition',
    durationUs: ms(350),
    tags: ['lướt', 'lên', 'swipe', 'scroll']
  },
  {
    id: 'riser',
    nameVi: 'Dâng trào',
    nameEn: 'Riser',
    category: 'transition',
    durationUs: ms(1500),
    tags: ['dâng', 'hồi hộp', 'trước hook', 'riser', 'build up']
  },
  {
    id: 'pop',
    nameVi: 'Bốp',
    nameEn: 'Pop',
    category: 'accent',
    durationUs: ms(150),
    tags: ['nhấn', 'bốp', 'pop', 'hiện chữ']
  },
  {
    id: 'ding',
    nameVi: 'Keng',
    nameEn: 'Ding',
    category: 'accent',
    durationUs: ms(800),
    tags: ['nhấn', 'chuông', 'ding', 'bell', 'đúng']
  },
  {
    id: 'sparkle',
    nameVi: 'Lấp lánh',
    nameEn: 'Sparkle',
    category: 'accent',
    durationUs: ms(600),
    tags: ['lấp lánh', 'long lanh', 'sparkle', 'magic']
  },
  {
    id: 'success',
    nameVi: 'Thành công',
    nameEn: 'Success',
    category: 'accent',
    durationUs: ms(700),
    tags: ['thành công', 'hoàn tất', 'success', 'chốt đơn']
  },
  {
    id: 'impact',
    nameVi: 'Đập mạnh',
    nameEn: 'Impact',
    category: 'impact',
    durationUs: ms(800),
    tags: ['đập', 'boom', 'impact', 'nhấn mạnh']
  },
  {
    id: 'notify',
    nameVi: 'Thông báo',
    nameEn: 'Notification',
    category: 'ui',
    durationUs: ms(500),
    tags: ['thông báo', 'tin nhắn', 'notification']
  },
  {
    id: 'tick',
    nameVi: 'Tích',
    nameEn: 'Tick',
    category: 'ui',
    durationUs: ms(90),
    tags: ['đếm ngược', 'tích tắc', 'tick', 'countdown']
  },
  {
    id: 'error',
    nameVi: 'Báo lỗi',
    nameEn: 'Error',
    category: 'ui',
    durationUs: ms(400),
    tags: ['lỗi', 'sai', 'error', 'từ chối']
  }
]

/** Tên file trong thư mục thư viện. Một chỗ duy nhất quyết định, để không lệch. */
export function soundEffectFileName(id: string): string {
  return `${id}.mp3`
}

export interface SoundEffectLibraryStatus {
  /** Hiệu ứng thật sự có file, kèm đường dẫn để nghe thử. */
  effects: Array<{ id: string; path: string }>
  /**
   * Đang chạy bản đóng gói hay bản dev.
   *
   * Thiếu file mang hai nghĩa hoàn toàn khác nhau: bản đóng gói thiếu là gói cài
   * hỏng, còn bản dev thiếu chỉ là chưa chạy script dựng. Nói nhầm thì người dùng
   * đi tìm một lỗi đóng gói không tồn tại.
   */
  packaged: boolean
}

export function findSoundEffect(id: string): SoundEffectDefinition | undefined {
  return SOUND_EFFECTS.find((effect) => effect.id === id)
}
