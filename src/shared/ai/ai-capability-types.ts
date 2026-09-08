/**
 * Mô tả năng lực của provider.
 *
 * Đây là cơ chế thực thi cho DESCRIPTION §3.B: "Không hiển thị các tham số mà
 * provider không hỗ trợ như thể chúng hoạt động."
 *
 * Giao diện KHÔNG được tự vẽ ô nhập nào. Nó chỉ dựng điều khiển từ danh sách
 * `parameters` mà adapter khai báo. Provider không có "cảm xúc" thì trên màn hình
 * không có ô cảm xúc — không phải làm mờ đi, mà là không tồn tại.
 *
 * Khai báo phụ thuộc vào MODEL chứ không chỉ provider, vì cùng một provider có
 * thể có model nhận tham số khác nhau.
 */

export type AiTaskKind = 'stt' | 'translate' | 'tts' | 'music'

/** Kiểu điều khiển mà giao diện sẽ dựng cho một tham số. */
export type ParameterControl = 'range' | 'select' | 'toggle'

export interface ParameterOption {
  value: string
  labelVi: string
  labelEn: string
}

export interface ProviderParameter {
  /** Tên trường đúng như provider nhận, ví dụ "stability". */
  key: string
  control: ParameterControl
  labelVi: string
  labelEn: string
  /** Giải thích ngắn hiện trong tooltip. */
  hintVi?: string
  hintEn?: string

  /** Chỉ dùng cho control 'range'. */
  min?: number
  max?: number
  step?: number

  /** Chỉ dùng cho control 'select'. */
  options?: ParameterOption[]

  defaultValue: number | string | boolean
}

export interface AudioOutputFormat {
  /** Giá trị gửi cho provider. */
  value: string
  label: string
  /** Đuôi file để lưu asset. */
  fileExtension: string
  sampleRate?: number
}

/** Cách lấy danh sách giọng đọc. */
export type VoiceCatalogKind =
  /** Provider có endpoint liệt kê giọng — luôn lấy danh sách trực tiếp. */
  | 'remote'
  /**
   * Provider không có endpoint liệt kê; danh sách giọng là tập cố định đã ghi
   * trong tài liệu chính thức. Giao diện phải nói rõ đây là danh mục cố định.
   */
  | 'static'

export interface TtsCapabilities {
  voiceCatalog: VoiceCatalogKind
  /** Có lọc giọng theo ngôn ngữ được không (provider phải trả thông tin ngôn ngữ). */
  supportsLanguageFilter: boolean
  /** Có nghe thử mẫu giọng sẵn có mà không tốn lượt gọi không. */
  supportsVoicePreviewSample: boolean
  /** Provider trả timestamp theo từ/ký tự kèm audio. */
  supportsTimestamps: boolean
  parameters: ProviderParameter[]
  outputFormats: AudioOutputFormat[]
  /** Giới hạn số ký tự mỗi lần gọi; không rõ thì để undefined. */
  maxCharactersPerRequest?: number
}

export interface ProviderModel {
  id: string
  label: string
  /** Mã ngôn ngữ BCP-47 provider nói là hỗ trợ. Rỗng = không công bố. */
  languages: string[]
  description?: string
}

/**
 * Thông tin tĩnh để giao diện dựng phần Cấu hình AI mà KHÔNG cần khoá API.
 * Nhờ vậy màn hình cài đặt vẫn dùng được khi chưa nhập khoá nào.
 */
export interface ProviderDescriptor {
  id: string
  name: string
  /** Tác vụ mà provider này đảm nhiệm được. */
  tasks: AiTaskKind[]
  /** Nhãn của ô nhập khoá, ví dụ "API key". */
  credentialLabel: string
  /** Trang lấy khoá, mở bằng trình duyệt hệ thống. */
  credentialHelpUrl: string
  /** Ghi chú hiển thị trong phần cài đặt. */
  noteVi?: string
  noteEn?: string
}

export interface ConnectionTestResult {
  ok: boolean
  /** Thông báo cho người dùng, đã dịch sẵn ở lớp adapter thì để nguyên. */
  message: string
  /** Thông tin thêm khi thành công, ví dụ số giọng đọc khả dụng. */
  details?: string
}

/** Lấy giá trị mặc định của toàn bộ tham số — dùng khi tạo preset mới. */
export function defaultParameterValues(
  parameters: ProviderParameter[]
): Record<string, number | string | boolean> {
  const values: Record<string, number | string | boolean> = {}
  for (const parameter of parameters) {
    values[parameter.key] = parameter.defaultValue
  }
  return values
}

/**
 * Bỏ những tham số không nằm trong khai báo năng lực.
 *
 * Preset lưu trong project có thể được tạo từ phiên bản ứng dụng cũ hoặc từ
 * provider khác. Gửi thẳng tham số lạ lên provider sẽ nhận về lỗi 400 khó hiểu.
 */
export function keepSupportedParameters(
  values: Record<string, number | string | boolean>,
  parameters: ProviderParameter[]
): Record<string, number | string | boolean> {
  const allowed = new Set(parameters.map((parameter) => parameter.key))
  const filtered: Record<string, number | string | boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    if (allowed.has(key)) filtered[key] = value
  }
  return filtered
}

/** Kẹp giá trị vào đúng khoảng provider chấp nhận trước khi gửi đi. */
export function clampParameterValue(
  parameter: ProviderParameter,
  value: number | string | boolean
): number | string | boolean {
  if (parameter.control !== 'range' || typeof value !== 'number') return value
  const min = parameter.min ?? Number.NEGATIVE_INFINITY
  const max = parameter.max ?? Number.POSITIVE_INFINITY
  return Math.max(min, Math.min(max, value))
}
