import type { Micros } from './time-units'

/**
 * Marker: một mốc có tên trên timeline — chỗ cần quay lại, ranh giới chương.
 *
 * Nằm ở CẤP TÀI LIỆU, không thuộc track hay clip nào: marker đánh dấu một thời
 * điểm của cả video, nên xoá hay dời clip không được kéo nó đi theo. Chỉ ripple
 * xoá trên MỌI track (tức cả video co lại) mới dời marker, cùng luật với phụ đề.
 */

export const MARKER_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type MarkerColor = (typeof MARKER_COLORS)[number]

export interface TimelineMarker {
  id: string
  atUs: Micros
  /** Có thể rỗng: marker chỉ để đánh dấu chỗ, chưa cần tên. */
  label: string
  color: MarkerColor
}

/** Marker sắp theo thời gian — thứ tự để vẽ, để nhảy tới marker kế, để in chương. */
export function sortedMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((left, right) => left.atUs - right.atUs)
}

/** Marker gần nhất SAU (`direction` 1) hoặc TRƯỚC (-1) `atUs`, bỏ qua marker trùng mốc. */
export function adjacentMarker(
  markers: readonly TimelineMarker[],
  atUs: Micros,
  direction: 1 | -1
): TimelineMarker | undefined {
  const sorted = sortedMarkers(markers)
  return direction === 1
    ? sorted.find((marker) => marker.atUs > atUs)
    : sorted.reverse().find((marker) => marker.atUs < atUs)
}

/**
 * Dời marker khi cả video bị cắt bỏ khoảng `[fromUs, toUs)`.
 *
 * Marker nằm TRONG khoảng bị xoá thì mất theo — nội dung nó đánh dấu không còn
 * nữa. Giữ lại và dồn về mép khoảng thì nhiều marker chồng lên cùng một chỗ, trỏ
 * vào thứ khác hẳn thứ người dùng đã đặt tên.
 */
export function rippleMarkers(
  markers: readonly TimelineMarker[],
  fromUs: Micros,
  toUs: Micros
): TimelineMarker[] {
  const span = toUs - fromUs
  return markers
    .filter((marker) => marker.atUs < fromUs || marker.atUs >= toUs)
    .map((marker) => (marker.atUs >= toUs ? { ...marker, atUs: marker.atUs - span } : marker))
}

/** "1:05" hoặc "1:02:05" — dạng YouTube đọc được trong mô tả video. */
function chapterTime(atUs: Micros): string {
  const total = Math.floor(atUs / 1_000_000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`
}

/**
 * Danh sách chương dán thẳng vào mô tả YouTube.
 *
 * YouTube chỉ nhận chương khi dòng đầu là 0:00, nên marker đầu tiên nằm sau 0
 * thì chèn một dòng `introLabel` ở 0:00 thay vì để cả danh sách bị bỏ qua lặng
 * lẽ. Marker không tên lấy tên theo số thứ tự.
 */
export function chapterListText(
  markers: readonly TimelineMarker[],
  introLabel: string,
  untitledLabel: (index: number) => string
): string {
  const sorted = sortedMarkers(markers)
  const lines = sorted.map(
    (marker, index) =>
      `${chapterTime(marker.atUs)} ${marker.label.trim() || untitledLabel(index + 1)}`
  )
  if (sorted.length > 0 && Math.floor(sorted[0].atUs / 1_000_000) > 0) {
    lines.unshift(`0:00 ${introLabel}`)
  }
  return lines.join('\n')
}
