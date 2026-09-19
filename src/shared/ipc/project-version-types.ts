import type { Micros } from '../domain/time-units'

/**
 * Lý do một bản chụp phiên bản được ghi.
 *
 * - `auto`: autosave chụp định kỳ
 * - `manual`: người dùng bấm "Lưu phiên bản ngay"
 * - `before-restore`: chụp ngay TRƯỚC khi khôi phục — nhờ nó mà khôi phục nhầm
 *   vẫn quay lại được, dù lịch sử hoàn tác không vươn qua lần khôi phục.
 */
export type ProjectVersionReason = 'auto' | 'manual' | 'before-restore'

export interface ProjectVersionSummary {
  fileName: string
  savedAt: string
  revision: number
  reason: ProjectVersionReason
  name: string
  clipCount: number
  durationUs: Micros
}
