import type { MediaAsset } from '../domain/media-asset-types'
import type { ProjectDocument } from '../domain/project-document-types'

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
  projectDelete: 'project:delete',
  projectSnapshot: 'project:snapshot',
  projectCheckMedia: 'project:check-media',

  mediaPickFiles: 'media:pick-files',
  mediaImport: 'media:import',
  mediaRelink: 'media:relink',
  mediaReadWaveform: 'media:read-waveform',

  exportPickPath: 'export:pick-path',
  exportStart: 'export:start',
  exportCancel: 'export:cancel',
  exportCapabilities: 'export:capabilities',

  appInfo: 'app:info'
} as const

/** Kênh main -> renderer. Tiến trình xuất được đẩy về chứ không để renderer hỏi liên tục. */
export const IPC_EVENT = {
  exportProgress: 'export:progress'
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
    snapshot(document: ProjectDocument): Promise<IpcResult<string>>
    checkMedia(document: ProjectDocument): Promise<IpcResult<MissingMediaReport[]>>
  }
  media: {
    pickFiles(): Promise<IpcResult<string[]>>
    import(request: ImportMediaRequest): Promise<IpcResult<ImportMediaResponse>>
    relink(asset: MediaAsset, newPath: string): Promise<IpcResult<MediaAsset>>
    readWaveform(waveformPath: string): Promise<IpcResult<WaveformData>>
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
