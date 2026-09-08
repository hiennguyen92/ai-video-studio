import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'
import type {
  ConnectionTestResult,
  ProviderDescriptor,
  ProviderModel,
  TtsCapabilities
} from '../ai/ai-capability-types'
import type { Voice } from '../ai/ai-provider-contracts'
import type { JobRecord } from '../jobs/job-types'

/**
 * Hợp đồng giữa renderer và main.
 *
 * Renderer chạy trong sandbox, không có Node. Mọi việc chạm tới đĩa, tiến trình
 * con hay khoá bí mật đều phải đi qua đây. Nhờ vậy khoá API không bao giờ lọt
 * vào bundle frontend (DESCRIPTION §6).
 */

export const IPC = {
  projectList: 'project:list',
  projectCreate: 'project:create',
  projectLoad: 'project:load',
  projectSave: 'project:save',
  projectScanGarbage: 'project:scan-garbage',
  projectRemoveGarbage: 'project:remove-garbage',
  projectDelete: 'project:delete',
  projectSnapshot: 'project:snapshot',
  projectCheckMedia: 'project:check-media',

  mediaPickFiles: 'media:pick-files',
  mediaImport: 'media:import',
  mediaRelink: 'media:relink',
  mediaReadWaveform: 'media:read-waveform',

  aiProviders: 'ai:providers',
  aiCredentialStatus: 'ai:credential-status',
  aiSetCredential: 'ai:set-credential',
  aiSetConfig: 'ai:set-config',
  aiDeleteCredential: 'ai:delete-credential',
  aiTestConnection: 'ai:test-connection',
  aiListModels: 'ai:list-models',
  aiListVoices: 'ai:list-voices',
  aiCapabilities: 'ai:capabilities',
  aiGenerateSpeech: 'ai:generate-speech',
  aiAttachGeneratedAudio: 'ai:attach-generated-audio',

  sttTranscribe: 'stt:transcribe',
  sttReadResult: 'stt:read-result',
  translateRun: 'translate:run',
  translateReadResult: 'translate:read-result',
  musicGenerate: 'music:generate',
  mediaRegisterLocal: 'media:register-local',
  mediaDetectShots: 'media:detect-shots',
  mcpRespond: 'mcp:respond',
  mcpStatus: 'mcp:status',
  chatSend: 'chat:send',
  chatReadHistory: 'chat:read-history',
  chatWriteHistory: 'chat:write-history',
  chatClearHistory: 'chat:clear-history',
  whisperListModels: 'whisper:list-models',
  whisperDownload: 'whisper:download',
  whisperCancelDownload: 'whisper:cancel-download',
  whisperDeleteModel: 'whisper:delete-model',

  jobList: 'job:list',
  jobCancel: 'job:cancel',
  jobClearFinished: 'job:clear-finished',

  exportPickPath: 'export:pick-path',
  exportStart: 'export:start',
  exportCancel: 'export:cancel',
  exportCapabilities: 'export:capabilities',

  appInfo: 'app:info'
} as const

/** Kênh main -> renderer. Tiến trình xuất được đẩy về chứ không để renderer hỏi liên tục. */
export const IPC_EVENT = {
  /** Máy chủ MCP hỏi renderer vì tài liệu chỉ nằm ở đó. */
  mcpRequest: 'mcp:request',
  exportProgress: 'export:progress',
  jobChanged: 'job:changed',
  whisperDownloadProgress: 'whisper:download-progress'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Bọc kết quả thay vì ném lỗi qua IPC — stack trace của main không có ích cho renderer. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface CreateProjectRequest {
  name: string
  aspectRatio?: '16:9' | '9:16' | '1:1'
}

export interface ImportMediaRequest {
  projectId: string
  filePaths: string[]
  /**
   * Asset đã có trong project, gửi kèm để main phát hiện file trùng nội dung.
   * Main không giữ trạng thái project — renderer mới là nơi nắm document hiện hành.
   */
  existing: MediaAsset[]
}

export interface ImportMediaResponse {
  assets: MediaAsset[]
  /** File bị bỏ qua vì đã có trong project. */
  duplicates: Array<{ path: string; existingAssetId: string }>
  failures: Array<{ path: string; error: string }>
}

export interface MissingMediaReport {
  assetId: string
  name: string
  path: string
}

export interface WaveformData {
  bucketsPerSecond: number
  /** Cặp (min, max) cho mỗi bucket, đã chuẩn hoá về khoảng -1..1. */
  peaks: number[]
}

export interface ExportRequest {
  /**
   * Bản chụp document tại thời điểm bấm Xuất.
   * Render đọc đúng bản này, nên chỉnh sửa trong lúc xuất không làm sai kết quả
   * (DESCRIPTION §8).
   */
  document: ProjectDocument
  outputPath: string
  width: number
  height: number
  frameRate: { num: number; den: number }
  useHardwareEncoder: boolean
  /**
   * Bộ dựng hình.
   *
   * `ffmpeg` nhanh hơn ~6,7 lần và là mặc định. `remotion` dùng CHUNG composition
   * với preview nên bản xuất không thể lệch bản xem trước, và là đường duy nhất
   * làm được chuyển cảnh cùng chữ động về sau.
   */
  engine?: 'ffmpeg' | 'remotion'
  /** Nung phụ đề vào hình. */
  burnSubtitleTrackId?: string
  /** Xuất thêm file .srt nằm cạnh video. */
  exportSrtTrackId?: string
}

export type ExportStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface ExportProgressEvent {
  jobId: string
  status: ExportStatus
  /** 0..1. Vắng mặt khi ffmpeg chưa báo mốc thời gian nào — KHÔNG bịa số. */
  ratio?: number
  outTimeUs: number
  speed?: number
  error?: string
  outputPath?: string
  /** Đường dẫn file .srt đã xuất kèm, nếu có. */
  srtPath?: string
}

export interface ExportCapabilities {
  /** Bộ mã hoá phần cứng có dùng được trên máy này không. */
  hardwareEncoderAvailable: boolean
  hardwareEncoderName?: string
}

/* ── AI ───────────────────────────────────────────────────────── */

export interface ProviderStatus {
  descriptor: ProviderDescriptor
  /** Đã lưu khoá cho provider này chưa. Không bao giờ trả giá trị khoá. */
  hasCredential: boolean
  /**
   * Cấu hình không bí mật đã lưu (ví dụ địa chỉ máy chủ tự host).
   * Trả nguyên giá trị — khác với khoá, đây không phải bí mật.
   */
  config: Record<string, string>
}

export interface AiSettingsSnapshot {
  providers: ProviderStatus[]
  /** Kho bí mật của hệ điều hành có dùng được không. */
  encryption: { available: boolean; backend: string }
}

export interface ListVoicesRequest {
  providerId: string
  language?: string
}

export interface GenerateSpeechIpcRequest {
  projectId: string
  providerId: string
  model: string
  voiceId: string
  text: string
  language?: string
  parameters: Record<string, number | string | boolean>
  outputFormat: string
  label: string
  sourceSegmentId?: string
}

export interface AttachGeneratedAudioRequest {
  jobId: string
  existingAssets: MediaAsset[]
  prompt?: string
  language?: string
  voiceId?: string
  sourceSegmentId?: string
}

export interface AttachGeneratedAudioResponse {
  asset: MediaAsset
  /** Kết quả trùng với asset đã có — nơi gọi nên dùng lại thay vì thêm mới. */
  alreadyInLibrary: boolean
}

/* ── Phiên âm ─────────────────────────────────────────────────── */

export interface TranscribeIpcRequest {
  projectId: string
  providerId: string
  sourcePath: string
  sourceInUs: number
  durationUs: number
  language?: string
  label: string
}

export interface TranscriptionSegmentDto {
  startUs: number
  endUs: number
  text: string
  words?: Array<{ startUs: number; endUs: number; text: string }>
  speaker?: string
}

export interface TranscriptionResultDto {
  language: string
  languageAutoDetected: boolean
  segments: TranscriptionSegmentDto[]
}

export interface TranslateIpcRequest {
  projectId: string
  providerId: string
  transcriptId: string
  sourceLanguage?: string
  targetLanguage: string
  glossary: Array<{ from: string; to: string }>
  segments: Array<{ id: string; text: string }>
  label: string
}

export interface TranslationResultDto {
  sourceLanguage: string
  targetLanguage: string
  model: string
  /** Luôn đủ số đoạn như đầu vào và giữ liên kết về đoạn gốc. */
  segments: Array<{ sourceSegmentId: string; text: string }>
  /** Đoạn mà mô hình không tuân thủ glossary; chỉ để cảnh báo. */
  glossaryViolations: Array<{ sourceSegmentId: string; from: string; to: string }>
}

export interface GenerateMusicRequest {
  projectId: string
  providerId: string
  model: string
  prompt: string
  durationSeconds: number
  parameters: Record<string, number | string | boolean>
  label: string
}

/** Máy chủ MCP hỏi renderer những gì. */
export interface McpBridgeRequest {
  requestId: string
  kind: 'project-overview' | 'transcript' | 'media' | 'shots' | 'apply-tools'
  payload: unknown
}

export interface McpBridgeResponse {
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}

/** Kết quả áp dụng một loạt lời gọi công cụ từ agent bên ngoài. */
export interface McpApplyResult {
  applied: boolean
  steps: string[]
  failures: Array<{ tool: string; reason: string }>
  /** Revision sau khi áp dụng, để agent biết dự án đã đổi. */
  revision: number
}

export interface McpServerStatus {
  running: boolean
  url?: string
  token?: string
  error?: string
}

export interface GarbageReportDto {
  fileCount: number
  totalBytes: number
}

export interface DetectedShotDto {
  index: number
  startUs: number
  endUs: number
  framePath?: string
  /** Ranh giới do chia đều một cú máy quá dài, không phải chỗ chuyển cảnh thật. */
  synthetic?: boolean
}

export interface ChatMessageRecord {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
  /** Mô tả các bước AI đề xuất ở lượt đó, để đọc lại sau khi mở lại dự án. */
  steps?: string[]
}

export interface ChatSendRequest {
  systemPrompt: string
  projectContext: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  userMessage: string
}

export interface ChatSendResponse {
  reply: string
  /** Lời gọi công cụ CHƯA kiểm tra — renderer mới là nơi xác thực và dịch sang lệnh. */
  toolCalls: Array<{ name: string; arguments: unknown }>
  plainTextOnly: boolean
  model: string
}

export interface WhisperModelDto {
  id: string
  fileName: string
  approximateBytes: number
  labelVi: string
  labelEn: string
  vietnameseQuality: 'kém' | 'khá' | 'tốt'
  /** Đã tải xong và dùng được. */
  downloaded: boolean
  path?: string
}

export interface WhisperDownloadProgressEvent {
  modelId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  receivedBytes: number
  totalBytes?: number
  /** Vắng khi máy chủ không báo tổng dung lượng — không đoán. */
  ratio?: number
  path?: string
  error?: string
}

export interface AppInfo {
  version: string
  platform: string
  locale: string
  /** Thư mục dữ liệu — hiển thị trong phần cài đặt để người dùng biết file nằm đâu. */
  userDataPath: string
}

/** API mà preload gắn vào `window.api`. */
export interface RendererApi {
  project: {
    list(): Promise<IpcResult<ProjectSummary[]>>
    create(request: CreateProjectRequest): Promise<IpcResult<ProjectDocument>>
    load(projectId: string): Promise<IpcResult<ProjectDocument>>
    save(document: ProjectDocument): Promise<IpcResult<void>>
    remove(projectId: string): Promise<IpcResult<void>>
    /** Đếm file rác do ứng dụng sinh ra mà không còn ai dùng. Chưa xoá gì. */
    scanGarbage(document: ProjectDocument): Promise<IpcResult<GarbageReportDto>>
    removeGarbage(document: ProjectDocument): Promise<IpcResult<GarbageReportDto>>
    snapshot(document: ProjectDocument): Promise<IpcResult<string>>
    checkMedia(document: ProjectDocument): Promise<IpcResult<MissingMediaReport[]>>
  }
  media: {
    pickFiles(): Promise<IpcResult<string[]>>
    import(request: ImportMediaRequest): Promise<IpcResult<ImportMediaResponse>>
    relink(asset: MediaAsset, newPath: string): Promise<IpcResult<MediaAsset>>
    /**
     * Đăng ký media của dự án đang mở với máy chủ http cục bộ và nhận lại URL.
     *
     * Remotion — cả Player lẫn bộ dựng khi xuất — chỉ nạp được http, không đọc
     * được đường dẫn đĩa.
     */
    registerLocal(
      entries: Array<{ id: string; path: string }>
    ): Promise<IpcResult<Record<string, string>>>
    /** Dò cú máy trong một asset và trích ảnh đại diện cho từng cú. */
    detectShots(request: {
      projectId: string
      assetId: string
      sourcePath: string
      force?: boolean
    }): Promise<IpcResult<DetectedShotDto[]>>
    readWaveform(waveformPath: string): Promise<IpcResult<WaveformData>>
  }
  ai: {
    settings(): Promise<IpcResult<AiSettingsSnapshot>>
    setCredential(providerId: string, apiKey: string): Promise<IpcResult<void>>
    setConfig(providerId: string, config: Record<string, string>): Promise<IpcResult<void>>
    deleteCredential(providerId: string): Promise<IpcResult<void>>
    testConnection(providerId: string): Promise<IpcResult<ConnectionTestResult>>
    listModels(providerId: string): Promise<IpcResult<ProviderModel[]>>
    listVoices(request: ListVoicesRequest): Promise<IpcResult<Voice[]>>
    capabilities(providerId: string, model: string): Promise<IpcResult<TtsCapabilities>>
    generateSpeech(request: GenerateSpeechIpcRequest): Promise<IpcResult<JobRecord>>
    attachGeneratedAudio(
      request: AttachGeneratedAudioRequest
    ): Promise<IpcResult<AttachGeneratedAudioResponse>>
  }
  stt: {
    transcribe(request: TranscribeIpcRequest): Promise<IpcResult<JobRecord>>
    readResult(jobId: string): Promise<IpcResult<TranscriptionResultDto>>
  }
  translate: {
    run(request: TranslateIpcRequest): Promise<IpcResult<JobRecord>>
    readResult(jobId: string): Promise<IpcResult<TranslationResultDto>>
  }
  music: {
    generate(request: GenerateMusicRequest): Promise<IpcResult<JobRecord>>
  }
  mcp: {
    /** Renderer trả lời một yêu cầu do máy chủ MCP gửi tới. */
    respond(response: McpBridgeResponse): void
    onRequest(listener: (request: McpBridgeRequest) => void): () => void
    status(): Promise<IpcResult<McpServerStatus>>
  }
  chat: {
    send(request: ChatSendRequest): Promise<IpcResult<ChatSendResponse>>
    readHistory(projectId: string): Promise<IpcResult<ChatMessageRecord[]>>
    writeHistory(projectId: string, messages: ChatMessageRecord[]): Promise<IpcResult<void>>
    clearHistory(projectId: string): Promise<IpcResult<void>>
  }
  whisper: {
    listModels(): Promise<IpcResult<WhisperModelDto[]>>
    download(modelId: string): Promise<IpcResult<void>>
    cancelDownload(modelId: string): Promise<IpcResult<void>>
    deleteModel(modelId: string): Promise<IpcResult<void>>
    onDownloadProgress(listener: (event: WhisperDownloadProgressEvent) => void): () => void
  }
  jobs: {
    list(projectId: string): Promise<IpcResult<JobRecord[]>>
    cancel(jobId: string): Promise<IpcResult<void>>
    clearFinished(projectId: string): Promise<IpcResult<void>>
    /** Trả về hàm huỷ đăng ký. */
    onChanged(listener: (job: JobRecord) => void): () => void
  }
  export: {
    capabilities(): Promise<IpcResult<ExportCapabilities>>
    pickOutputPath(defaultFileName: string): Promise<IpcResult<string | null>>
    start(request: ExportRequest): Promise<IpcResult<{ jobId: string }>>
    cancel(jobId: string): Promise<IpcResult<void>>
    /** Trả về hàm huỷ đăng ký. */
    onProgress(listener: (event: ExportProgressEvent) => void): () => void
  }
  app: {
    info(): Promise<IpcResult<AppInfo>>
  }
  /** Nền tảng hệ điều hành, đọc đồng bộ để bố cục dựng đúng ngay lần render đầu. */
  platform: string
}

/** Scheme tuỳ biến để renderer phát media local mà không cần mở `file://`. */
export const MEDIA_PROTOCOL_SCHEME = 'avstudio-media'

/** Đổi đường dẫn tuyệt đối thành URL mà thẻ <video>/<img> dùng được. */
export function mediaFileUrl(absolutePath: string): string {
  return `${MEDIA_PROTOCOL_SCHEME}://local/${encodeURIComponent(absolutePath)}`
}
