import { applyEditorCommand } from '../commands/editor-command-reducer'
import type { ProjectDocument } from './project-document-types'
import { sortedMarkers } from './timeline-marker-types'
import type { Micros } from './time-units'

/**
 * Xuất một ĐOẠN của timeline thay vì cả video.
 *
 * Cách làm: cắt bản sao tài liệu về đúng đoạn đó bằng chính lệnh ripple xoá của
 * trình sửa — bỏ phần sau đoạn, rồi bỏ phần trước và dồn lên — rồi đưa bản đã cắt
 * cho bộ dựng như một dự án bình thường. Không bộ dựng nào phải biết khái niệm
 * "đoạn", nên cả hai bộ dựng đều xuất được đoạn mà không sửa dòng nào, và clip,
 * phụ đề, chữ overlay, marker đều được cắt theo đúng một luật.
 */

/** Xa hơn mọi dự án thật: ~115 ngày. Dùng làm mép phải khi bỏ "mọi thứ phía sau". */
const FAR_FUTURE_US: Micros = 10_000_000_000_000

export interface ExportRange {
  startUs: Micros
  endUs: Micros
}

/**
 * Bản sao tài liệu chỉ còn đoạn `[startUs, endUs)`, dời về bắt đầu từ 0.
 *
 * Mở khoá mọi lane trên BẢN SAO: lane khoá chặn ripple xoá, mà khoá là để chống
 * sửa nhầm trên timeline, không phải để loại lane đó khỏi file xuất.
 */
export function documentForExportRange(
  document: ProjectDocument,
  range: ExportRange
): ProjectDocument {
  if (range.endUs <= range.startUs) throw new Error('Đoạn xuất phải có độ dài lớn hơn 0')

  const copy = structuredClone(document)
  for (const track of copy.tracks) track.locked = false

  const steps = [
    { fromUs: range.endUs, toUs: FAR_FUTURE_US },
    { fromUs: 0, toUs: range.startUs }
  ].filter((step) => step.toUs > step.fromUs)

  for (const step of steps) {
    const result = applyEditorCommand(copy, { type: 'timeline/ripple-delete', ...step })
    if (!result.ok) throw new Error(`Không cắt được đoạn xuất: ${result.error}`)
  }
  return copy
}

export interface MarkerSection {
  /** Id marker mở đầu đoạn. */
  markerId: string
  label: string
  startUs: Micros
  endUs: Micros
}

/**
 * Các đoạn giữa hai marker liền nhau; đoạn cuối chạy tới hết video.
 *
 * Marker đánh dấu CHỖ BẮT ĐẦU của một phần (đúng như danh sách chương), nên đoạn
 * của marker thứ i là từ nó tới marker kế tiếp.
 */
export function markerSections(
  markers: ProjectDocument['markers'],
  durationUs: Micros
): MarkerSection[] {
  const sorted = sortedMarkers(markers).filter((marker) => marker.atUs < durationUs)
  return (
    sorted
      .map((marker, index) => ({
        markerId: marker.id,
        label: marker.label,
        startUs: marker.atUs,
        endUs: sorted[index + 1]?.atUs ?? durationUs
      }))
      // Hai marker cùng một mốc sinh ra đoạn rỗng — chọn nó là xuất hỏng.
      .filter((section) => section.endUs > section.startUs)
  )
}
