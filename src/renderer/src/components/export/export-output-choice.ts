import { markerSections, type ExportRange } from '../../../../shared/domain/export-range'
import type { ExportQuality } from '../../../../shared/domain/export-presets'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'

/** Lựa chọn mẫu, chất lượng và đoạn xuất trong hộp thoại Xuất. */

export type RangeKey = 'all' | 'custom' | `marker:${string}`

export interface ExportOutputChoice {
  presetId: string
  quality: ExportQuality
  rangeKey: RangeKey
  customFromSeconds: number
  customToSeconds: number
}

/** Đoạn xuất theo lựa chọn; `undefined` là cả video. `null` là đoạn không hợp lệ. */
export function resolveExportRange(
  choice: ExportOutputChoice,
  document: ProjectDocument,
  durationUs: number
): ExportRange | undefined | null {
  if (choice.rangeKey === 'all') return undefined
  if (choice.rangeKey === 'custom') {
    const startUs = Math.round(Math.max(0, choice.customFromSeconds) * 1_000_000)
    const endUs = Math.round(Math.min(durationUs / 1_000_000, choice.customToSeconds) * 1_000_000)
    return endUs > startUs ? { startUs, endUs } : null
  }
  const markerId = choice.rangeKey.slice('marker:'.length)
  const section = markerSections(document.markers, durationUs).find(
    (item) => item.markerId === markerId
  )
  return section ? { startUs: section.startUs, endUs: section.endUs } : null
}
