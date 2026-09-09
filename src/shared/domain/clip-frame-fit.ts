/**
 * Chỗ mà một tấm ảnh thật sự CHIẾM trong khung hình.
 *
 * `object-fit: contain` vẽ ảnh vừa khít bên trong thẻ và chừa hai dải trống hai
 * bên, nhưng THẺ vẫn to bằng cả khung hình. Khung điều khiển trên bản xem trước
 * đo theo thẻ, nên nếu không tính lại thì nó bao trọn khung hình trong khi ảnh
 * chỉ nằm ở giữa — kéo một đằng, ảnh nhúc nhích một nẻo.
 *
 * Tính ở đây thay vì đo trong trình duyệt: lớp dựng khi XUẤT file không có DOM
 * để đo, mà preview và bản xuất phải ra cùng một khung hình (DESCRIPTION §4).
 */

export interface Size {
  width: number
  height: number
}

/**
 * Kích thước lớn nhất giữ nguyên tỉ lệ mà vẫn lọt trong khung.
 *
 * Trả về chính khung khi thiếu số đo: ảnh không probe được kích thước thì thà
 * vẽ đầy khung còn hơn không vẽ gì.
 */
export function fitInsideFrame(natural: Partial<Size> | undefined, frame: Size): Size {
  const width = natural?.width ?? 0
  const height = natural?.height ?? 0
  if (width <= 0 || height <= 0) return frame

  const scale = Math.min(frame.width / width, frame.height / height)
  return { width: width * scale, height: height * scale }
}

/**
 * Dịch chuyển của clip, đổi từ tỉ lệ khung hình sang pixel.
 *
 * `ClipTransform.x/y` được khai báo là tỉ lệ (-1..1, 0 là giữa) nhưng lớp vẽ
 * từng đem thẳng con số đó làm pixel — kéo thanh "Vị trí X" hết cỡ chỉ dịch được
 * MỘT pixel, và ô chỉnh coi như không có tác dụng.
 *
 * Một đơn vị = nửa khung hình, nên x = 1 đẩy tâm clip ra đúng mép phải.
 */
export function clipOffsetPx(transform: { x: number; y: number }, frame: Size): Size {
  return {
    width: (transform.x * frame.width) / 2,
    height: (transform.y * frame.height) / 2
  }
}
