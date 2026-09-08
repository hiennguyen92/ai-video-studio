import type { Micros } from './time-units'

/**
 * Vị trí nên tua tới khi người dùng muốn XEM một khối chữ.
 *
 * Không tua tới đúng mốc bắt đầu. Chữ overlay vào bằng hiệu ứng, mà khung đầu
 * tiên của hiệu ứng vào luôn có `opacity: 0` — tua tới đó là rơi trúng khung duy
 * nhất mà chữ vô hình. Người dùng bấm vào một câu để xem nó, và thấy màn hình
 * trống.
 *
 * Đo thật trên một dự án có sẵn: tại đúng mốc bắt đầu `opacity` bằng 0, nhích vào
 * giữa khoảng thì bằng 1.
 *
 * Nhích vào một quãng ngắn là đủ qua hiệu ứng vào mặc định (0,35 giây), nhưng
 * không được nhích quá một phần ba khối — câu nửa giây mà nhích 0,4 giây thì lại
 * rơi sang phần hiệu ứng RA, cũng đang mờ dần.
 */

const MAX_LEAD_IN_US = 400_000

export function previewSeekUs(startUs: Micros, endUs: Micros): Micros {
  const duration = endUs - startUs
  if (duration <= 0) return startUs

  return startUs + Math.min(MAX_LEAD_IN_US, Math.floor(duration / 3))
}
