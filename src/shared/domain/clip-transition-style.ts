import { cinematicTransitionStyleAt } from './clip-transition-cinematic'
import { GL_CSS_FALLBACK, isGlTransitionKind } from './clip-transition-gl'
import {
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuart,
  smootherStep
} from './transition-easing'
import {
  BASIC_TRANSITION_KINDS,
  isTransitionKind,
  type BasicTransitionKind,
  type TransitionKind
} from './timeline-track-types'

/**
 * Kiểu CSS của một chuyển cảnh ở một mức tiến độ.
 *
 * Tách khỏi component React vì hai lẽ. Một, cùng bộ này phục vụ CẢ hiệu ứng vào
 * lẫn hiệu ứng ra. Hai, hàm thuần thì kiểm được bằng con số, còn một hook thì không.
 */

export interface TransitionStyle {
  opacity: number
  transform?: string
  clipPath?: string
  filter?: string
  /** Mặt nạ mép mềm. Nhiều lớp thì phải kèm `maskComposite`. */
  maskImage?: string
  /** Cách gộp khi có nhiều mặt nạ. */
  maskComposite?: string
  /** Lớp phủ vẽ ĐÈ lên clip — vệt sáng ở mép quét. Giá trị `background` của CSS. */
  overlay?: string
}

/**
 * Mép clip mà chuyển cảnh đang chạy: đầu clip (`in`) hay cuối clip (`out`).
 *
 * Kiểu KHÔNG hướng bỏ qua tham số này. Kiểu CÓ hướng thì bắt buộc phải nhìn vào
 * nó: clip đi phải rời sang phía ngược với phía clip đến bước vào. Trước đây hiệu
 * ứng ra chỉ là hiệu ứng vào chạy ngược, nên clip đi và clip đến cùng dồn về một
 * bên và để hở nền ở bên kia suốt chuyển cảnh.
 */
export type TransitionEdge = 'in' | 'out'

const BASIC_KINDS: ReadonlySet<string> = new Set(BASIC_TRANSITION_KINDS)

function isBasicKind(kind: TransitionKind): kind is BasicTransitionKind {
  return BASIC_KINDS.has(kind)
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

/**
 * `progress` 0 là clip chưa hiện gì, 1 là hiện hẳn — ở CẢ hai mép. Mép ra nhận
 * tiến độ chạy ngược (1 ở đầu chuyển cảnh, 0 ở cuối), nên hai phía luôn nói cùng
 * một điều: "clip này đang hiện bao nhiêu".
 *
 * `frame` chỉ dùng cho hiệu ứng nhiễu và rung.
 */
export function transitionStyleAt(
  kind: TransitionKind,
  progress: number,
  frame: number,
  edge: TransitionEdge = 'in'
): TransitionStyle {
  // Hết chuyển cảnh thì KHÔNG để lại dấu vết nào. `interpolate` kẹp phải, nên
  // tiến độ đứng ở 1 suốt phần đời còn lại của clip; một `blur(0px)` hay
  // `translateX(0%)` còn sót vẫn đẩy clip sang lớp vẽ riêng và làm nó lệch màu so
  // với clip không có chuyển cảnh.
  if (progress >= 1) return { opacity: 1 }
  // Tên kiểu lạ (file dự án sửa tay, hay chép từ bản mới hơn) không được làm sập
  // bản dựng: nhánh `switch` rơi hết sẽ trả `undefined` và lớp vẽ nổ khi đọc độ mờ.
  if (!isTransitionKind(kind)) return { opacity: 1 }
  // Kiểu WebGL vẽ bản lùi CSS ngay trên clip. Lớp WebGL nằm ĐÈ lên và chỉ hiện khi
  // nó vẽ xong, nên chạy được thì không ai thấy bản lùi, còn không thì không ai
  // thấy chỗ hổng.
  if (isGlTransitionKind(kind)) {
    return transitionStyleAt(GL_CSS_FALLBACK[kind], progress, frame, edge)
  }
  if (!isBasicKind(kind)) return cinematicTransitionStyleAt(kind, progress, frame, edge)

  // Dấu của hướng: clip đi rời sang phía NGƯỢC LẠI với phía clip đến bước vào.
  const away = edge === 'in' ? 1 : -1

  switch (kind) {
    case 'fade':
      // Không bẻ cong: mờ chồng tuyến tính mới đúng về mặt quang học, easing vào
      // đây chỉ làm chỗ giao tối đi một nhịp.
      return { opacity: progress }

    case 'slide-left':
      return slide('X', away * slideOffset(progress))
    case 'slide-right':
      return slide('X', -away * slideOffset(progress))
    case 'slide-up':
      return slide('Y', away * slideOffset(progress))
    case 'slide-down':
      return slide('Y', -away * slideOffset(progress))

    case 'wipe-left':
      // Lộ dần từ mép phải sang trái; phần chưa lộ bị cắt đi chứ không mờ. Clip
      // đi giữ phần bên KIA của cùng một mép, nên khung hình luôn kín.
      return wipe(easeInOutCubic(progress), edge === 'in' ? 'left' : 'right')
    case 'wipe-right':
      return wipe(easeInOutCubic(progress), edge === 'in' ? 'right' : 'left')

    case 'zoom': {
      const eased = easeOutQuart(progress)
      return { opacity: eased, transform: `scale(${round(1 + (1 - eased) * 0.25)})` }
    }

    // Lia vụt: trượt nhanh hơn hẳn slide và kèm mờ chuyển động. Không có phần mờ
    // thì nó chỉ là một cú trượt nhanh, mất hẳn cảm giác "vụt". Nảy lại một nhịp
    // ở cuối cho ra cảm giác ghìm máy.
    case 'whip-left':
      return whip('X', away * whipOffset(progress), progress)
    case 'whip-right':
      return whip('X', -away * whipOffset(progress), progress)

    case 'blur': {
      const eased = easeOutCubic(progress)
      return { opacity: eased, filter: `blur(${round((1 - eased) * 26)}px)` }
    }

    case 'glitch': {
      // Giật ngang theo khung hình chứ không theo tiến độ: nhiễu phải rời rạc,
      // nội suy mượt sẽ thành một cú trượt chứ không phải nhiễu. Không easing.
      const jitter = Math.sin(frame * 13.7) * (1 - progress) * 4
      return {
        opacity: 1,
        transform: `translateX(${jitter}%)`,
        filter: `hue-rotate(${Math.sin(frame * 7.3) * (1 - progress) * 90}deg) saturate(${1 + (1 - progress) * 2})`
      }
    }

    case 'spin': {
      // Quá đà một chút rồi về: xoay dừng phắt ở đúng 0 độ trông như bị khoá.
      const eased = easeOutBack(progress, 0.9)
      return {
        opacity: progress,
        transform: `rotate(${round((1 - eased) * -14)}deg) scale(${round(1 + (1 - eased) * 0.35)})`
      }
    }

    case 'flash':
      // Loé rồi tắt nhanh: dùng luỹ thừa để phần sáng chỉ chiếm đoạn đầu, không
      // kéo trắng suốt cả chuyển cảnh. Luỹ thừa đã là easing của chính nó.
      return { opacity: 1, filter: `brightness(${1 + (1 - progress) ** 2 * 6})` }
  }
}

/** Quãng trượt còn lại, tính theo phần trăm khung. */
function slideOffset(progress: number): number {
  return (1 - easeInOutCubic(progress)) * 100
}

/** Lia vụt đi xa hơn slide và nảy lại ở cuối. */
function whipOffset(progress: number): number {
  return (1 - easeOutBack(smootherStep(progress), 0.25)) * 140
}

function slide(axis: 'X' | 'Y', offset: number): TransitionStyle {
  return { opacity: 1, transform: `translate${axis}(${round(offset)}%)` }
}

function whip(axis: 'X' | 'Y', offset: number, progress: number): TransitionStyle {
  return {
    opacity: 1,
    // Phóng bù đúng phần quá đà: lúc nảy, clip vượt qua vị trí nghỉ trong khi clip
    // kia đã đi xa, nên mép đối diện hở ra một vệt mỏng nền trống.
    transform: `translate${axis}(${round(offset)}%) scale(${offset >= 0 ? 1 : round(1 + Math.abs(offset) / 100)})`,
    filter: `blur(${round((1 - easeOutCubic(progress)) * 14)}px)`
  }
}

/**
 * `side` là phía clip bị CẮT VÀO: `'left'` cắt từ mép trái, tức giữ lại phần bên
 * phải. Clip đi nhận phía kia, nên hai phép cắt cộng lại đúng một khung hình.
 */
function wipe(amount: number, side: 'left' | 'right'): TransitionStyle {
  const cut = round((1 - amount) * 100)
  return {
    opacity: 1,
    clipPath: side === 'left' ? `inset(0 0 0 ${cut}%)` : `inset(0 ${cut}% 0 0)`
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
  const masks = [enter.maskImage, exit.maskImage].filter(Boolean)
  return {
    opacity: enter.opacity * exit.opacity,
    transform: [enter.transform, exit.transform].filter(Boolean).join(' ') || undefined,
    filter: [enter.filter, exit.filter].filter(Boolean).join(' ') || undefined,
    // Hai phép cắt không chồng được lên nhau trong CSS; lấy phép đang thật sự
    // cắt, và ưu tiên hiệu ứng ra vì nó là thứ đang diễn ra sau cùng.
    clipPath: exit.clipPath ?? enter.clipPath,
    // Mặt nạ thì chồng được: giữ cả hai và lấy phần GIAO. Lấy một cái thôi là
    // giai đoạn kia coi như không có mặt nạ, và clip hiện nguyên ở phần đáng lẽ
    // đã bị cắt.
    maskImage: masks.length > 0 ? masks.join(', ') : undefined,
    maskComposite: masks.length > 1 ? 'intersect' : undefined,
    overlay: [enter.overlay, exit.overlay].filter(Boolean).join(', ') || undefined
  }
}
