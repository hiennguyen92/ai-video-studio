import type { FrameRate, Micros } from './time-units'

/**
 * Media asset = một file nguồn đã được import hoặc do AI tạo ra.
 *
 * Nội dung AI tạo ra (giọng đọc, nhạc, ảnh) trở thành asset THẬT y hệt file import,
 * nên nó xuất hiện trong thư viện, kéo được vào timeline, cắt/sửa/undo được
 * (DESCRIPTION §4). Không có "asset ảo" chỉ tồn tại trong panel AI.
 */

export type MediaKind = 'video' | 'audio' | 'image'

/** Tác vụ AI đã sinh ra asset này. */
export type GeneratedTask = 'tts' | 'music' | 'sfx' | 'image' | 'video' | 'voice-cleanup'

export interface MediaSourceRef {
  /** Đường dẫn tuyệt đối trên đĩa. */
  path: string
  /** Đường dẫn tương đối khi file nằm trong thư mục project (giúp di chuyển project). */
  relativePath?: string
  /**
   * Hiệu ứng âm thanh dựng sẵn trong app, theo id trong danh mục.
   *
   * Có trường này thì `path` chỉ là kết quả phân giải của LẦN CHẠY NÀY, không
   * phải dữ liệu bền: gỡ app, mở trên máy khác hay đổi bản cài đều làm nó sai.
   * Lúc mở dự án, đường dẫn được trỏ lại từ id.
   */
  builtinId?: string
  /** Hash nội dung — dùng để chống trùng khi import và để liên kết lại media bị thiếu. */
  contentHash: string
  sizeBytes: number
  mtimeMs: number
}

export interface MediaProbe {
  durationUs: Micros
  width?: number
  height?: number
  frameRate?: FrameRate
  /** Góc xoay từ display matrix (0/90/180/270). Preview và export đều phải tôn trọng. */
  rotation?: number
  hasVideo: boolean
  hasAudio: boolean
  audioChannels?: number
  audioSampleRate?: number
  videoCodec?: string
  audioCodec?: string
}

/** Dữ liệu phái sinh, nằm trong cache — xoá đi vẫn tạo lại được, không phải nguồn sự thật. */
export interface MediaDerived {
  thumbnailPath?: string
  /** Sprite sheet dùng vẽ filmstrip trên timeline. */
  filmstripPath?: string
  filmstripFrameCount?: number
  /** File nhị phân chứa peak waveform. */
  waveformPath?: string
  /**
   * File JSON chứa danh sách cú máy đã phát hiện, kèm đường dẫn ảnh đại diện.
   *
   * Là dữ liệu phái sinh như thumbnail: xoá đi vẫn dò lại được, nên nằm trong
   * cache chứ không nằm trong tài liệu project.
   */
  shotsPath?: string
}

export interface GeneratedOrigin {
  task: GeneratedTask
  providerId: string
  model: string
  jobId: string
  /**
   * Hash của toàn bộ tham số yêu cầu. Khi retry một job, fingerprint trùng nghĩa là
   * đã có kết quả — tái sử dụng thay vì chèn asset trùng (DESCRIPTION §6).
   */
  requestFingerprint: string
  prompt?: string
  /** Segment của transcript/bản dịch đã sinh ra đoạn audio này (dùng cho lồng tiếng). */
  sourceSegmentId?: string
  language?: string
  voiceId?: string
  /**
   * Asset GỐC đã sinh ra asset này — với giọng đã làm sạch. Làm sạch lại với mức
   * khác phải đi từ bản gốc, không phải từ bản đã lọc: lọc chồng lên bản lọc là
   * dồn méo tiếng mỗi lần.
   */
  sourceAssetId?: string
}

export interface MediaAsset {
  id: string
  kind: MediaKind
  name: string
  source: MediaSourceRef
  probe: MediaProbe
  derived: MediaDerived
  origin: 'import' | 'generated' | 'builtin'
  generated?: GeneratedOrigin
  /** Nhãn người dùng tự gán, dùng để lọc trong thư viện. */
  tags: string[]
  createdAt: string
  /** Bật khi kiểm tra lúc mở project thấy file không còn — kích hoạt UI liên kết lại. */
  missing: boolean
}
