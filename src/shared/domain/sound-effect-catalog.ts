import type { Micros } from './time-units'

/**
 * Thư viện hiệu ứng âm thanh dựng sẵn trong app.
 *
 * Nguồn là các file thu sẵn trong `resources/sound-effects/`, mỗi file tên
 * `<id>.mp3`. Lúc build, `scripts/build-sound-effects.mjs` chuẩn hoá độ to rồi
 * chép sang `out/sound-effects/` để đóng gói. File gốc giữ nguyên, không sửa tay.
 *
 * Thêm một hiệu ứng: thả file vào thư mục nguồn, thêm một mục ở đây. Script build
 * ném lỗi nếu file và danh mục lệch nhau, theo cả hai chiều.
 *
 * Danh mục nằm ở `shared` vì ba nơi cùng đọc nó: script dựng file lúc build,
 * giao diện, và công cụ MCP cho agent. Chép làm ba bản là mời chúng lệch nhau.
 */

export type SoundEffectCategory = 'transition' | 'accent' | 'impact' | 'ui' | 'reaction' | 'loop'

export interface SoundEffectDefinition {
  /** Khoá bền: dự án lưu id này, KHÔNG lưu đường dẫn. Cũng là tên file nguồn. */
  id: string
  nameVi: string
  nameEn: string
  category: SoundEffectCategory
  durationUs: Micros
  /** Từ khoá cho agent chọn. Agent không nghe được file, chỉ đọc được chữ này. */
  tags: string[]
}

const ms = (value: number): Micros => value * 1000

export const SOUND_EFFECTS: SoundEffectDefinition[] = [
  // --- Chuyển cảnh ---
  {
    id: 'airy-short-whoosh',
    nameVi: 'Vụt nhẹ ngắn',
    nameEn: 'Airy short whoosh',
    category: 'transition',
    durationUs: ms(790),
    tags: ['chuyển cảnh', 'vụt', 'whoosh', 'transition', 'swipe']
  },
  {
    id: 'soft-air-whoosh',
    nameVi: 'Vụt gió êm',
    nameEn: 'Soft air whoosh',
    category: 'transition',
    durationUs: ms(680),
    tags: ['chuyển cảnh', 'nhẹ', 'gió', 'whoosh', 'transition']
  },
  {
    id: 'simple-whoosh',
    nameVi: 'Vụt đơn giản',
    nameEn: 'Simple whoosh',
    category: 'transition',
    durationUs: ms(1320),
    tags: ['chuyển cảnh', 'vụt', 'lướt', 'whoosh', 'transition']
  },
  {
    id: 'deep-short-whoosh',
    nameVi: 'Vụt trầm',
    nameEn: 'Deep short whoosh',
    category: 'transition',
    durationUs: ms(1340),
    tags: ['chuyển cảnh', 'trầm', 'mạnh', 'whoosh', 'transition']
  },
  {
    id: 'sharp-bass-riser',
    nameVi: 'Dâng trầm ngắn',
    nameEn: 'Sharp bass riser',
    category: 'transition',
    durationUs: ms(940),
    tags: ['dâng', 'trước hook', 'riser', 'build up', 'bass']
  },
  {
    id: 'fast-suspense-riser',
    nameVi: 'Dâng hồi hộp nhanh',
    nameEn: 'Fast suspense riser',
    category: 'transition',
    durationUs: ms(4420),
    tags: ['dâng', 'hồi hộp', 'căng thẳng', 'riser', 'suspense']
  },
  {
    id: 'long-suspense-riser',
    nameVi: 'Dâng hồi hộp dài',
    nameEn: 'Long suspense riser',
    category: 'transition',
    durationUs: ms(3770),
    tags: ['dâng', 'hồi hộp', 'cao trào', 'riser', 'suspense']
  },
  {
    id: 'glitchy-tv-signal',
    nameVi: 'Nhiễu sóng TV',
    nameEn: 'Glitchy TV signal',
    category: 'transition',
    durationUs: ms(980),
    tags: ['glitch', 'nhiễu', 'tv', 'lỗi hình', 'chuyển cảnh']
  },
  {
    id: 'tv-switch-off-noise',
    nameVi: 'Tắt TV',
    nameEn: 'TV switch off',
    category: 'transition',
    durationUs: ms(240),
    tags: ['tắt', 'tv', 'kết thúc', 'switch off', 'chuyển cảnh']
  },

  // --- Nhấn nhá ---
  {
    id: 'tiny-bubble-pop',
    nameVi: 'Bốp bong bóng nhỏ',
    nameEn: 'Tiny bubble pop',
    category: 'accent',
    durationUs: ms(170),
    tags: ['nhấn', 'bốp', 'pop', 'hiện chữ', 'bubble']
  },
  {
    id: 'synthetic-bubble-pop',
    nameVi: 'Bốp bong bóng',
    nameEn: 'Synthetic bubble pop',
    category: 'accent',
    durationUs: ms(360),
    tags: ['nhấn', 'bốp', 'pop', 'hiện icon', 'bubble']
  },
  {
    id: 'clean-ding',
    nameVi: 'Keng',
    nameEn: 'Clean ding',
    category: 'accent',
    durationUs: ms(1680),
    tags: ['nhấn', 'chuông', 'ding', 'bell', 'đúng', 'ý tưởng']
  },
  {
    id: 'success-chime',
    nameVi: 'Thành công',
    nameEn: 'Success chime',
    category: 'accent',
    durationUs: ms(990),
    tags: ['thành công', 'hoàn tất', 'success', 'chime', 'lấp lánh']
  },
  {
    id: 'cash-register-success',
    nameVi: 'Máy tính tiền',
    nameEn: 'Cash register',
    category: 'accent',
    durationUs: ms(2060),
    tags: ['tiền', 'chốt đơn', 'bán hàng', 'cash', 'ka-ching']
  },
  {
    id: 'camera-shutter',
    nameVi: 'Chụp ảnh',
    nameEn: 'Camera shutter',
    category: 'accent',
    durationUs: ms(460),
    tags: ['chụp ảnh', 'màn trập', 'camera', 'shutter', 'ảnh tĩnh']
  },
  {
    id: 'short-shutter-click',
    nameVi: 'Màn trập ngắn',
    nameEn: 'Short shutter click',
    category: 'accent',
    durationUs: ms(240),
    tags: ['chụp ảnh', 'màn trập', 'camera', 'shutter', 'click']
  },
  {
    id: 'vintage-camera-shutter',
    nameVi: 'Máy ảnh cổ',
    nameEn: 'Vintage camera shutter',
    category: 'accent',
    durationUs: ms(360),
    tags: ['chụp ảnh', 'cổ điển', 'camera', 'shutter', 'vintage']
  },
  {
    id: 'short-drum-roll-sting',
    nameVi: 'Trống chốt',
    nameEn: 'Short drum roll sting',
    category: 'accent',
    durationUs: ms(740),
    tags: ['trống', 'chốt', 'punchline', 'drum', 'sting', 'ba dum tss']
  },

  // --- Va đập ---
  {
    id: 'deep-impact-hit',
    nameVi: 'Đập trầm',
    nameEn: 'Deep impact hit',
    category: 'impact',
    durationUs: ms(1150),
    tags: ['đập', 'trầm', 'impact', 'nhấn mạnh', 'hit']
  },
  {
    id: 'vine-boom-impact',
    nameVi: 'Boom (Vine)',
    nameEn: 'Vine boom',
    category: 'impact',
    durationUs: ms(2900),
    tags: ['boom', 'meme', 'vine', 'impact', 'bất ngờ', 'nhấn mạnh']
  },
  {
    id: 'dramatic-thunder-roll',
    nameVi: 'Sấm rền',
    nameEn: 'Dramatic thunder roll',
    category: 'impact',
    durationUs: ms(8180),
    tags: ['sấm', 'kịch tính', 'thunder', 'u ám', 'dramatic']
  },

  // --- Giao diện ---
  {
    id: 'crisp-ui-click',
    nameVi: 'Nhấp giòn',
    nameEn: 'Crisp UI click',
    category: 'ui',
    durationUs: ms(180),
    tags: ['nhấp', 'click', 'bấm nút', 'ui', 'tick']
  },
  {
    id: 'mouse-click',
    nameVi: 'Nhấp chuột',
    nameEn: 'Mouse click',
    category: 'ui',
    durationUs: ms(240),
    tags: ['nhấp', 'chuột', 'click', 'mouse', 'màn hình']
  },
  {
    id: 'gear-turn-click',
    nameVi: 'Bánh răng xoay',
    nameEn: 'Gear turn click',
    category: 'ui',
    durationUs: ms(670),
    tags: ['bánh răng', 'xoay', 'cơ khí', 'gear', 'click']
  },
  {
    id: 'ui-pop-up-alert',
    nameVi: 'Cảnh báo bật lên',
    nameEn: 'UI pop-up alert',
    category: 'ui',
    durationUs: ms(410),
    tags: ['cảnh báo', 'bật lên', 'popup', 'alert', 'lỗi']
  },
  {
    id: 'new-notification-ping',
    nameVi: 'Thông báo mới',
    nameEn: 'New notification ping',
    category: 'ui',
    durationUs: ms(530),
    tags: ['thông báo', 'ping', 'notification', 'mới']
  },
  {
    id: 'phone-notification-ping',
    nameVi: 'Thông báo điện thoại',
    nameEn: 'Phone notification ping',
    category: 'ui',
    durationUs: ms(820),
    tags: ['thông báo', 'điện thoại', 'tin nhắn', 'notification', 'phone']
  },
  {
    id: 'sent-message-ping',
    nameVi: 'Gửi tin nhắn',
    nameEn: 'Sent message ping',
    category: 'ui',
    durationUs: ms(380),
    tags: ['gửi', 'tin nhắn', 'chat', 'message', 'sent']
  },
  {
    id: 'video-call-ringtone',
    nameVi: 'Chuông gọi video',
    nameEn: 'Video call ringtone',
    category: 'ui',
    durationUs: ms(3480),
    tags: ['cuộc gọi', 'chuông', 'video call', 'ringtone', 'điện thoại']
  },

  // --- Phản ứng, hài ---
  {
    id: 'anime-wow-reaction',
    nameVi: 'Wow kiểu anime',
    nameEn: 'Anime wow reaction',
    category: 'reaction',
    durationUs: ms(3740),
    tags: ['wow', 'anime', 'ngạc nhiên', 'reaction', 'hài']
  },
  {
    id: 'awkward-crow-flyby',
    nameVi: 'Quạ bay ngượng ngùng',
    nameEn: 'Awkward crow flyby',
    category: 'reaction',
    durationUs: ms(1750),
    tags: ['ngượng', 'im lặng', 'quạ', 'awkward', 'hài', 'meme']
  },
  {
    id: 'sitcom-laugh-track',
    nameVi: 'Tiếng cười sitcom',
    nameEn: 'Sitcom laugh track',
    category: 'reaction',
    durationUs: ms(2500),
    tags: ['cười', 'khán giả', 'sitcom', 'laugh', 'hài']
  },
  {
    id: 'record-scratch-stop',
    nameVi: 'Đĩa xước dừng',
    nameEn: 'Record scratch stop',
    category: 'reaction',
    durationUs: ms(670),
    tags: ['dừng lại', 'đĩa xước', 'record scratch', 'khoan đã', 'hài']
  },
  {
    id: 'record-scratch-rewind',
    nameVi: 'Tua ngược đĩa',
    nameEn: 'Record scratch rewind',
    category: 'reaction',
    durationUs: ms(1490),
    tags: ['tua lại', 'quay ngược', 'rewind', 'record scratch', 'flashback']
  },
  {
    id: 'censor-beep',
    nameVi: 'Bíp kiểm duyệt',
    nameEn: 'Censor beep',
    category: 'reaction',
    durationUs: ms(790),
    tags: ['bíp', 'kiểm duyệt', 'che từ', 'censor', 'beep']
  },

  // --- Nền, lặp ---
  {
    id: 'keyboard-typing-loop',
    nameVi: 'Gõ phím',
    nameEn: 'Keyboard typing loop',
    category: 'loop',
    durationUs: ms(15580),
    tags: ['gõ phím', 'bàn phím', 'typing', 'keyboard', 'làm việc']
  },
  {
    id: 'slow-dell-keyboard-typing',
    nameVi: 'Gõ phím chậm',
    nameEn: 'Slow keyboard typing',
    category: 'loop',
    durationUs: ms(68350),
    tags: ['gõ phím', 'chậm', 'bàn phím', 'typing', 'văn phòng']
  },
  {
    id: 'mechanical-clicking-loop',
    nameVi: 'Lách cách cơ khí',
    nameEn: 'Mechanical clicking loop',
    category: 'loop',
    durationUs: ms(2930),
    tags: ['lách cách', 'cơ khí', 'máy móc', 'clicking', 'loop']
  },
  {
    id: 'light-clock-tick',
    nameVi: 'Đồng hồ tích tắc',
    nameEn: 'Light clock tick',
    category: 'loop',
    durationUs: ms(50300),
    tags: ['đồng hồ', 'tích tắc', 'đếm ngược', 'countdown', 'chờ đợi']
  }
]

/**
 * Id của bản thư viện cũ (tổng hợp bằng ffmpeg) → id tương đương hiện tại.
 *
 * Dự án đã lưu `builtinId` cũ. Bỏ id đi mà không trỏ tiếp thì mở lại dự án sẽ
 * báo thiếu media cho thứ vốn nằm trong app, và người dùng không tự sửa được.
 */
export const LEGACY_SOUND_EFFECT_IDS: Record<string, string> = {
  'whoosh-fast': 'airy-short-whoosh',
  'whoosh-soft': 'soft-air-whoosh',
  'swipe-up': 'simple-whoosh',
  riser: 'sharp-bass-riser',
  pop: 'tiny-bubble-pop',
  ding: 'clean-ding',
  sparkle: 'success-chime',
  success: 'success-chime',
  impact: 'deep-impact-hit',
  notify: 'new-notification-ping',
  tick: 'crisp-ui-click',
  error: 'ui-pop-up-alert'
}

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

/** Tra theo id; id của bản cũ được dẫn sang hiệu ứng tương đương. */
export function findSoundEffect(id: string): SoundEffectDefinition | undefined {
  const canonical = LEGACY_SOUND_EFFECT_IDS[id] ?? id
  return SOUND_EFFECTS.find((effect) => effect.id === canonical)
}
