import type { TransitionEdge } from './clip-transition-style'

/**
 * Bộ đồ nghề của nhóm chuyển cảnh điện ảnh: mặt nạ mép mềm, tiến độ quy về mốc
 * chung, và mấy phép làm tròn.
 *
 * Tách riêng vì đây là phần khó nhất về ý mà lại ngắn nhất về chữ: cái quy tắc
 * "hai phía dùng CÙNG một mốc, chỉ đổi phần đặc với phần trong" là thứ giữ cho
 * hai clip bù nhau khít, và nó đáng được đọc một mình chứ không lẫn giữa mười
 * một công thức.
 */

/** Bề rộng mép mềm của mặt nạ, tính theo phần trăm cạnh. */
export const WIPE_FEATHER = 12
export const CIRCLE_FEATHER = 6

/**
 * Tiến độ của CHUYỂN CẢNH nhìn từ một clip bất kỳ, 0 ở đầu chuyển cảnh.
 *
 * Clip đến đếm xuôi: tiến độ của nó chính là tiến độ chuyển cảnh. Clip đi nhận
 * phần còn lại (1 ở đầu, 0 ở cuối), nên phải lật về. Quy hai phía về CÙNG một mốc
 * thời gian rồi mới bẻ cong bằng easing là cách duy nhất để hai mặt nạ bù nhau
 * khít khịt; bẻ cong trước rồi mới lật thì với easing không đối xứng, hai mép sẽ
 * lệch nhau vài phần trăm khung và hở ra một vệt nền.
 */
export function sweep(progress: number, edge: TransitionEdge): number {
  return edge === 'in' ? progress : 1 - progress
}

/**
 * Mặt nạ gradient có mép mềm.
 *
 * `complement` lấy phần bù: cùng một mốc `stop`, chỉ đổi chỗ phần trong suốt với
 * phần đặc. Nhờ vậy độ mờ của hai clip cộng lại đúng bằng 1 ở mọi điểm trong dải
 * mép mềm, kể cả giữa chừng.
 */
export function featheredMask(
  direction: 'to left' | 'to right' | 'to top' | 'to bottom' | 'circle',
  stopPercent: number,
  feather: number,
  complement: boolean
): string {
  const [near, far] = complement ? ['#0000', '#000'] : ['#000', '#0000']
  const stops = `${near} ${round(stopPercent)}%, ${far} ${round(stopPercent + feather)}%`
  return direction === 'circle'
    ? `radial-gradient(circle at 50% 50%, ${stops})`
    : `linear-gradient(${direction}, ${stops})`
}

/** Mốc mép của mặt nạ: lùi ra ngoài khung đúng bằng bề rộng mép mềm ở hai đầu. */
export function maskStopAt(amount: number, feather: number): number {
  return amount * (100 + feather) - feather
}

/**
 * Mức phóng bù cho quãng quá đà của easing nảy.
 *
 * `offset` âm nghĩa là clip đã vượt qua vị trí nghỉ. Phóng thêm đúng phần vượt ấy
 * thì mép đối diện vẫn phủ kín khung, mà cú nảy thì giữ nguyên.
 */
export function overshootScale(offset: number): number {
  return offset >= 0 ? 1 : round(1 + Math.abs(offset) / 100)
}

export function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
