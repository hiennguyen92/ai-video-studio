/**
 * Vòng đời của một tác vụ nền (DESCRIPTION §6).
 *
 * Mọi việc dài hơi — sinh giọng đọc, phiên âm, dịch, xuất video — đều là một job
 * có trạng thái rõ ràng, huỷ được, thử lại được, và báo lỗi bằng ngôn ngữ người
 * dùng hiểu.
 */

export type JobKind = 'tts' | 'stt' | 'translate' | 'music'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface JobProgress {
  /**
   * 0..1 khi backend báo tiến trình THẬT.
   * `undefined` nghĩa là không biết — giao diện phải hiện trạng thái vô định.
   * Tuyệt đối không điền số tự chế vào đây (DESCRIPTION §6).
   */
  value?: number
  indeterminate: boolean
  /** Mô tả bước đang chạy, ví dụ "Đang sinh đoạn 3/8". */
  stage?: string
}

export interface JobError {
  kind: string
  message: string
  retryable: boolean
}

export interface JobRecord {
  id: string
  kind: JobKind
  /**
   * Job luôn thuộc về đúng một project.
   * Kết quả chỉ được ghi vào project này, kể cả khi người dùng đã chuyển sang
   * project khác trong lúc job chạy (DESCRIPTION §7).
   */
  projectId: string
  status: JobStatus
  progress: JobProgress
  /** Nhãn hiển thị trong danh sách tác vụ. */
  label: string
  /**
   * Vân tay của toàn bộ tham số đầu vào.
   * Retry với fingerprint trùng sẽ dùng lại kết quả cũ thay vì sinh asset trùng.
   */
  fingerprint: string
  providerId: string
  model: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: JobError
  /** Đường dẫn kết quả trong cache của project, có khi job thành công. */
  resultPath?: string
  /** Kết quả lấy lại từ cache chứ không gọi provider lần nữa. */
  servedFromCache?: boolean
}

/** Sự kiện main -> renderer mỗi khi job đổi trạng thái. */
export interface JobEvent {
  job: JobRecord
}

export function isJobFinished(job: JobRecord): boolean {
  return job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled'
}

export function isJobActive(job: JobRecord): boolean {
  return job.status === 'queued' || job.status === 'running'
}
