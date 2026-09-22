/**
 * Hàm easing dùng cho chuyển cảnh.
 *
 * Tiến độ tuyến tính làm mọi chuyển cảnh trông cứng: trượt với vận tốc không đổi
 * rồi dừng phắt. Mọi shader chuyển cảnh nghiêm túc đều bẻ cong tiến độ trước khi
 * dùng, và phần lớn cái "mượt" nằm ở đây chứ không ở công thức vẽ.
 *
 * MỌI hàm trong file này phải thoả `f(0) = 0` và `f(1) = 1`, và tăng đơn điệu.
 * Đó là điều kiện để chiều RA dùng lại được cùng công thức với chiều VÀO: chiều ra
 * chạy cùng hàm trên phần tiến độ còn lại, nên một hàm không chạm đúng hai đầu sẽ
 * làm clip nhảy một nấc ngay lúc chuyển cảnh bắt đầu hoặc kết thúc.
 */

/** Tăng tốc rồi giảm tốc. Mặc định cho trượt và gạt. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** Vọt lên rất nhanh rồi ghìm dần. Hợp với phóng và nhoè: kết thúc phải êm. */
export function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4
}

/** Như trên nhưng hiền hơn. */
export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * Chậm hai đầu, rất nhanh ở giữa — smootherstep của Ken Perlin.
 * Dùng cho vệt quét: mép phải lướt qua khung chứ không bò đều.
 */
export function smootherStep(t: number): number {
  return t * t * t * (10 - 15 * t + 6 * t * t)
}

/**
 * Quá đà rồi về. `overshoot` là mức vượt quá 1 ở gần cuối.
 *
 * Vẫn chạm đúng 0 và 1 ở hai đầu — phần quá đà nằm hẳn bên trong quãng, nên bất
 * biến hai đầu không bị phá.
 */
export function easeOutBack(t: number, overshoot = 1.2): number {
  const c3 = overshoot + 1
  return 1 + c3 * (t - 1) ** 3 + overshoot * (t - 1) ** 2
}
