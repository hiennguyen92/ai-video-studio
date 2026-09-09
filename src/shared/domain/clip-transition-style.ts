import type { TransitionKind } from './timeline-track-types'

/**
 * Kiểu CSS của một chuyển cảnh ở một mức tiến độ.
 *
 * Tách khỏi component React vì hai lẽ. Một, cùng bộ này phục vụ CẢ hiệu ứng vào
 * lẫn hiệu ứng ra — ra chỉ là vào chạy ngược, nên viết hai bản là mời chúng lệch
 * nhau. Hai, hàm thuần thì kiểm được bằng con số, còn một hook thì không.
 */

export interface TransitionStyle {
  opacity: number
  transform?: string
  clipPath?: string
  filter?: string
}

/** `progress` 0 là chưa hiện gì, 1 là hiện hẳn. `frame` chỉ dùng cho hiệu ứng nhiễu. */
export function transitionStyleAt(
  kind: TransitionKind,
  progress: number,
  frame: number
): TransitionStyle {
  const offset = (1 - progress) * 100

  switch (kind) {
    case 'fade':
      return { opacity: progress }
    case 'slide-left':
      return { opacity: 1, transform: `translateX(${offset}%)` }
    case 'slide-right':
      return { opacity: 1, transform: `translateX(${-offset}%)` }
    case 'slide-up':
      return { opacity: 1, transform: `translateY(${offset}%)` }
    case 'slide-down':
      return { opacity: 1, transform: `translateY(${-offset}%)` }
    case 'wipe-left':
      // Lộ dần từ mép phải sang trái; phần chưa lộ bị cắt đi chứ không mờ.
      return { opacity: 1, clipPath: `inset(0 0 0 ${offset}%)` }
    case 'wipe-right':
      return { opacity: 1, clipPath: `inset(0 ${offset}% 0 0)` }
    case 'zoom':
      return { opacity: progress, transform: `scale(${1 + (1 - progress) * 0.25})` }

    // Lia vụt: trượt nhanh hơn hẳn slide và kèm mờ chuyển động. Không có phần mờ
    // thì nó chỉ là một cú trượt nhanh, mất hẳn cảm giác "vụt".
    case 'whip-left':
      return {
        opacity: 1,
        transform: `translateX(${offset * 1.4}%)`,
        filter: `blur(${(1 - progress) * 14}px)`
      }
    case 'whip-right':
      return {
        opacity: 1,
        transform: `translateX(${-offset * 1.4}%)`,
        filter: `blur(${(1 - progress) * 14}px)`
      }

    case 'blur':
      return { opacity: progress, filter: `blur(${(1 - progress) * 26}px)` }

    case 'glitch': {
      // Giật ngang theo khung hình chứ không theo tiến độ: nhiễu phải rời rạc,
      // nội suy mượt sẽ thành một cú trượt chứ không phải nhiễu.
      const jitter = Math.sin(frame * 13.7) * (1 - progress) * 4
      return {
        opacity: 1,
        transform: `translateX(${jitter}%)`,
        filter: `hue-rotate(${Math.sin(frame * 7.3) * (1 - progress) * 90}deg) saturate(${1 + (1 - progress) * 2})`
      }
    }

    case 'spin':
      return {
        opacity: progress,
        transform: `rotate(${(1 - progress) * -14}deg) scale(${1 + (1 - progress) * 0.35})`
      }

    case 'flash':
      // Loé rồi tắt nhanh: dùng luỹ thừa để phần sáng chỉ chiếm đoạn đầu, không
      // kéo trắng suốt cả chuyển cảnh.
      return { opacity: 1, filter: `brightness(${1 + (1 - progress) ** 2 * 6})` }
  }
}

/**
 * Gộp kiểu của hiệu ứng VÀO và hiệu ứng RA.
 *
 * Clip ngắn có thể đang ở trong cả hai giai đoạn cùng lúc. Độ mờ NHÂN vào nhau,
 * còn phép biến đổi và bộ lọc thì nối lại — ghi đè sẽ làm clip bật về rõ hẳn rồi
 * mới biến mất.
 */
export function combineTransitionStyles(
  enter: TransitionStyle,
  exit: TransitionStyle | null
): TransitionStyle {
  if (!exit) return enter
  return {
    opacity: enter.opacity * exit.opacity,
    transform: [enter.transform, exit.transform].filter(Boolean).join(' ') || undefined,
    filter: [enter.filter, exit.filter].filter(Boolean).join(' ') || undefined,
    // Hai phép cắt không chồng được lên nhau trong CSS; lấy phép đang thật sự
    // cắt, và ưu tiên hiệu ứng ra vì nó là thứ đang diễn ra sau cùng.
    clipPath: exit.clipPath ?? enter.clipPath
  }
}
