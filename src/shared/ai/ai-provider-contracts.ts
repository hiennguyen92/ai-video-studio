import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel,
  TtsCapabilities
} from './ai-capability-types'

/**
 * Interface cho từng NHÓM tác vụ AI (DESCRIPTION §6).
 *
 * Tách theo nhóm tác vụ chứ không theo nhà cung cấp: một nhà cung cấp có thể làm
 * nhiều tác vụ, và một tác vụ có nhiều nhà cung cấp thay thế nhau được. Phần còn
 * lại của ứng dụng chỉ nói chuyện với các interface này, nên đổi provider không
 * lan ra ngoài lớp adapter.
 *
 * Adapter CHỈ chạy ở tiến trình main. Chúng nhận khoá API qua `AdapterContext`;
 * khoá không bao giờ đi qua renderer.
 */

export interface AdapterContext {
  apiKey: string
  /**
   * Cấu hình không bí mật của provider, ví dụ `baseUrl` cho bản tự host.
   * Rỗng với provider chạy trên dịch vụ đám mây có địa chỉ cố định.
   */
  config?: Record<string, string>
  /** Huỷ giữa chừng khi người dùng bấm huỷ job. */
  signal: AbortSignal
  /**
   * Chỉ gọi khi provider báo tiến trình THẬT.
   * Không gọi với số tự chế — job sẽ hiện trạng thái vô định thay vì phần trăm giả.
   */
  onProgress?(ratio: number): void
}

/* ── Text-to-speech ───────────────────────────────────────────── */

export interface Voice {
  id: string
  name: string
  /**
   * Mã ngôn ngữ provider công bố ĐÃ XÁC THỰC cho giọng này, đã khử trùng lặp.
   * Rỗng = provider không công bố gì.
   *
   * Lưu ý: đây KHÔNG phải giới hạn cứng. Model đa ngôn ngữ vẫn đọc được ngôn ngữ
   * không nằm trong danh sách này; trường này chỉ nói giọng đã được xác thực với
   * những ngôn ngữ nào.
   */
  languages: string[]
  /**
   * Phân loại của provider, ví dụ "premade" hay "professional".
   *
   * Có ý nghĩa thực tế: quan sát trên tài khoản thật cho thấy gói miễn phí bị
   * chặn dùng giọng thư viện (HTTP 402), nên giao diện cần cho người dùng biết
   * trước thay vì để họ bấm tạo rồi mới gặp lỗi.
   */
  category?: string
  /**
   * Giọng này có được xác thực cho ngôn ngữ mà nơi gọi yêu cầu không.
   *
   * Chỉ có giá trị khi `listVoices` được gọi kèm ngôn ngữ. Cố tình là CỜ ĐÁNH
   * DẤU chứ không phải bộ lọc: dữ liệu thật cho thấy một tài khoản có 23 giọng
   * thì chỉ 2 giọng được xác thực tiếng Việt, và cả hai đều thuộc loại thư viện
   * mà gói miễn phí không dùng được. Lọc cứng sẽ giấu mất 21 giọng vẫn đọc
   * tiếng Việt tốt khi đi cùng model đa ngôn ngữ.
   */
  verifiedForLanguage?: boolean
  /** URL mẫu giọng sẵn có, nghe thử mà không tốn lượt sinh audio. */
  previewUrl?: string
  description?: string
  /** Nhãn tự do của provider (giới tính, độ tuổi, phong cách…). */
  labels?: Record<string, string>
}

export interface TtsRequest {
  model: string
  voiceId: string
  text: string
  language?: string
  /** Đã được lọc theo khai báo năng lực trước khi tới đây. */
  parameters: Record<string, number | string | boolean>
  outputFormat: string
}

export interface TtsResult {
  audio: Uint8Array
  contentType: string
  /** Đuôi file để lưu asset, ví dụ "mp3". */
  fileExtension: string
}

export interface TtsAdapter {
  readonly descriptor: ProviderDescriptor
  /** Năng lực có thể khác nhau theo model, nên phải truyền model vào. */
  capabilities(model: string): TtsCapabilities
  listModels(context: AdapterContext): Promise<ProviderModel[]>
  listVoices(context: AdapterContext, options?: { language?: string }): Promise<Voice[]>
  synthesize(context: AdapterContext, request: TtsRequest): Promise<TtsResult>
  testConnection(context: AdapterContext): Promise<ConnectionTestResult>
}

/* ── Speech-to-text (Mốc 3) ───────────────────────────────────── */

export interface SttRequest {
  model: string
  audioPath: string
  /** Bỏ trống để provider tự nhận diện ngôn ngữ. */
  language?: string
  wantWordTimestamps: boolean
  wantSpeakerLabels: boolean
}

export interface SttWord {
  startUs: number
  endUs: number
  text: string
}

export interface SttSegment {
  startUs: number
  endUs: number
  text: string
  words?: SttWord[]
  speaker?: string
}

export interface SttResult {
  language: string
  languageAutoDetected: boolean
  segments: SttSegment[]
}

export interface SttAdapter {
  readonly descriptor: ProviderDescriptor
  listModels(context: AdapterContext): Promise<ProviderModel[]>
  transcribe(context: AdapterContext, request: SttRequest): Promise<SttResult>
  testConnection(context: AdapterContext): Promise<ConnectionTestResult>
}

/* ── Dịch (Mốc 3) ─────────────────────────────────────────────── */

export interface TranslateRequest {
  model: string
  sourceLanguage?: string
  targetLanguage: string
  /** Dịch theo mảng để giữ liên kết 1-1 với segment gốc. */
  segments: Array<{ id: string; text: string }>
  glossary?: Array<{ from: string; to: string }>
}

export interface TranslateResult {
  segments: Array<{ id: string; text: string }>
}

export interface TranslateAdapter {
  readonly descriptor: ProviderDescriptor
  listModels(context: AdapterContext): Promise<ProviderModel[]>
  translate(context: AdapterContext, request: TranslateRequest): Promise<TranslateResult>
  testConnection(context: AdapterContext): Promise<ConnectionTestResult>
}

/* ── Sinh nhạc (Mốc 4) ────────────────────────────────────────── */

export interface MusicRequest {
  model: string
  prompt: string
  durationSeconds: number
  parameters: Record<string, number | string | boolean>
}

export interface MusicResult {
  audio: Uint8Array
  contentType: string
  fileExtension: string
}

export interface MusicAdapter {
  readonly descriptor: ProviderDescriptor
  listModels(context: AdapterContext): Promise<ProviderModel[]>
  generate(context: AdapterContext, request: MusicRequest): Promise<MusicResult>
  testConnection(context: AdapterContext): Promise<ConnectionTestResult>
}

/**
 * Lỗi có phân loại, để giao diện nói được điều hữu ích thay vì dán nguyên
 * thông báo thô của provider.
 */
export type ProviderErrorKind =
  | 'missing-credential'
  | 'invalid-credential'
  /**
   * Khoá HỢP LỆ nhưng không đủ quyền cho thao tác này.
   *
   * Tách khỏi 'invalid-credential' vì cách xử lý hoàn toàn khác: khoá sai thì
   * phải thay khoá, còn thiếu quyền thì chỉ cần bật thêm quyền cho đúng khoá đó.
   * Gộp chung sẽ khiến người dùng dán lại khoá cũ mãi mà không hiểu vì sao hỏng.
   */
  | 'insufficient-permission'
  | 'rate-limited'
  | 'quota-exceeded'
  | 'timeout'
  | 'cancelled'
  | 'bad-request'
  | 'server-error'
  | 'network'
  | 'unknown'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind
  readonly providerId: string
  readonly status?: number
  /** Thử lại có khả năng thành công không — quyết định có hiện nút "Thử lại". */
  readonly retryable: boolean

  constructor(options: {
    kind: ProviderErrorKind
    providerId: string
    message: string
    status?: number
    retryable?: boolean
  }) {
    super(options.message)
    this.name = 'ProviderError'
    this.kind = options.kind
    this.providerId = options.providerId
    this.status = options.status
    this.retryable =
      options.retryable ??
      // Lỗi tạm thời thì đáng thử lại; khoá sai hay yêu cầu sai thì thử lại vô ích.
      ['rate-limited', 'timeout', 'server-error', 'network'].includes(options.kind)
  }
}
