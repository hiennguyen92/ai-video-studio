/**
 * Kéo thả để sắp lại thứ tự lane.
 *
 * Thứ tự lane quyết định thứ tự LỚP khi dựng hình — lane dưới cùng nằm trên cùng
 * — nên đây không phải chuyện sắp xếp cho gọn mắt: nó đổi hẳn cái gì che cái gì.
 *
 * Tách thành hàm thuần vì phép đổi chỉ số ở đây dễ lệch một đơn vị nhất. Lệnh
 * `track/reorder` GỠ lane ra rồi mới chèn lại, nên chỗ chèn phải tính trên danh
 * sách đã thiếu một phần tử; nhầm chỗ này thì lane nhảy sai một hàng và người
 * dùng chỉ thấy nó "không chịu vào đúng chỗ".
 */

export interface RowBounds {
  top: number
  bottom: number
}

/**
 * Khe sẽ chèn vào, đếm theo danh sách GỐC: 0 là trước hàng đầu, `rows.length` là
 * sau hàng cuối.
 *
 * Lấy mốc giữa mỗi hàng: con trỏ qua nửa trên thì chèn trước hàng đó, qua nửa
 * dưới thì chèn sau. Dùng mép hàng thay vì mốc giữa sẽ khiến hàng chỉ đổi chỗ khi
 * kéo vượt hẳn qua một hàng, và cảm giác là nó dính.
 */
export function insertionSlot(pointerY: number, rows: RowBounds[]): number {
  for (const [index, row] of rows.entries()) {
    if (pointerY < (row.top + row.bottom) / 2) return index
  }
  return rows.length
}

/**
 * Khe đó, quy về `toIndex` của lệnh `track/reorder`.
 *
 * Lệnh gỡ lane ra trước rồi chèn, nên mọi khe nằm SAU vị trí cũ đều tụt đi một.
 */
export function reorderToIndex(slot: number, fromIndex: number): number {
  return slot > fromIndex ? slot - 1 : slot
}

/** Phép kéo có thật sự đổi chỗ không — để không ghi một bước hoàn tác rỗng. */
export function reorderChangesOrder(slot: number, fromIndex: number): boolean {
  return reorderToIndex(slot, fromIndex) !== fromIndex
}
