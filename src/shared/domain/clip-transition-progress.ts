/**
 * Tiến độ của chuyển cảnh tại một khung, nhìn từ mỗi mép.
 *
 * Tách khỏi component vì đây là chỗ hai phía của một chỗ nối GẶP NHAU, và cái
 * gặp nhau đó phải kiểm được bằng con số. Nằm trong hook thì phép thử chỉ với tới
 * được bảng kiểu, còn phép chia ra tiến độ thì không — mà lỗi từng nằm đúng ở
 * phép chia.
 *
 * Quy ước chung của cả hai: giá trị trả về là "clip này đang hiện bao nhiêu",
 * 0 là chưa hiện gì, 1 là hiện hẳn.
 */

/** Khung tính từ đầu clip đến. Chuyển cảnh chiếm `frames` khung đầu. */
export function enterProgressAt(frame: number, frames: number): number {
  if (frames <= 0) return 1
  return clamp01(frame / frames)
}

/**
 * Khung tính từ đầu clip đi. Chuyển cảnh chiếm `frames` khung CUỐI.
 *
 * Mẫu số là `frames`, đúng bằng mẫu số của mép vào. Lấy `durationInFrames - 1`
 * làm mốc cuối thì mẫu số thành `frames - 1`: hai phía của cùng một chỗ nối lệch
 * nhau tới nửa khung, và ở giữa quãng — nơi easing dốc gấp ba — nửa khung ấy nở
 * ra thành một dải nền hở gần một phần mười bề ngang khung.
 *
 * Hệ quả đúng: ở khung cuối cùng của clip đi, tiến độ dừng ở `1/frames` chứ không
 * về 0, vì lúc đó clip đến mới ở `(frames-1)/frames`. Hai số cộng lại vẫn bằng 1.
 */
export function exitProgressAt(frame: number, frames: number, durationInFrames: number): number {
  if (frames <= 0) return 1
  return clamp01((durationInFrames - frame) / frames)
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
