import type { Micros } from './time-units'

/**
 * Tính khoảng thời gian mới khi kéo một khối chữ trên timeline.
 *
 * Tách thành hàm THUẦN vì đây là chỗ dễ sinh ra khoảng ngược nhất: kéo mép trái
 * vượt qua mép phải, hoặc kéo cả khối về trước mốc 0. Reducer từ chối khoảng
 * ngược, nhưng nó từ chối IM LẶNG — người dùng chỉ thấy khối bật về chỗ cũ mà
 * không hiểu vì sao. Nên phải kẹp ở đây, trước khi lệnh được phát ra.
 */

/**
 * Trỏ tới MỘT khối chữ trong tài liệu.
 *
 * Hai nhánh chứ không phải một id chung: cue phụ đề chỉ định vị được khi biết cả
 * track chứa nó, còn chữ overlay nằm ở cấp tài liệu nên chỉ cần id. Gộp làm một
 * sẽ phải đoán loại từ tiền tố id — đoán sai thì lệnh phát ra sai chỗ.
 *
 * Dùng chung cho cả kéo trên timeline lẫn vùng chọn đang hiện ở panel thuộc tính.
 */
export type TextBlockRef =
  | { kind: 'overlay'; overlayId: string }
  | { kind: 'subtitle'; subtitleTrackId: string; cueId: string }

export type TextBlockDragMode = 'move' | 'trim-start' | 'trim-end'

export interface TextBlockRange {
  startUs: Micros
  endUs: Micros
}

/**
 * Khối ngắn nhất còn kéo được.
 *
 * 100ms: đủ để còn nhìn thấy và bấm trúng trên timeline ở mức phóng thường dùng.
 * Nhỏ hơn nữa thì khối co lại thành một vạch và không tài nào kéo ra lại được.
 */
export const MIN_TEXT_BLOCK_DURATION_US = 100_000

/**
 * `proposedUs` là vị trí (đã bắt dính) của thứ đang bị kéo: điểm bắt đầu khi
 * `move` và khi `trim-start`, điểm kết thúc khi `trim-end`.
 */
export function applyTextBlockDrag(
  original: TextBlockRange,
  mode: TextBlockDragMode,
  proposedUs: number,
  minDurationUs: number = MIN_TEXT_BLOCK_DURATION_US
): TextBlockRange {
  const duration = Math.max(minDurationUs, original.endUs - original.startUs)
  const proposed = Math.round(proposedUs)

  if (mode === 'move') {
    // Giữ nguyên độ dài. Kéo lùi quá mốc 0 thì dừng ở 0 chứ không cắt ngắn khối:
    // người dùng đang DỜI chứ không đang cắt.
    const startUs = Math.max(0, proposed)
    return { startUs, endUs: startUs + duration }
  }

  if (mode === 'trim-start') {
    const maxStart = original.endUs - minDurationUs
    return { startUs: Math.min(Math.max(0, proposed), maxStart), endUs: original.endUs }
  }

  const minEnd = original.startUs + minDurationUs
  return { startUs: original.startUs, endUs: Math.max(proposed, minEnd) }
}

/** Khoảng có thay đổi thật không — để không ghi một bước hoàn tác rỗng. */
export function textBlockRangeChanged(before: TextBlockRange, after: TextBlockRange): boolean {
  return before.startUs !== after.startUs || before.endUs !== after.endUs
}
