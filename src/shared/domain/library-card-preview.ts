import { motionTransformAt, motionTransformCss } from './clip-motion-types'
import { transitionStyleAt, type TransitionStyle } from './clip-transition-style'
import type { LibraryClipItem } from './library-clip-effects'

/**
 * Khung hình minh hoạ của một thẻ trong tab Library, theo thời gian đã trôi.
 *
 * Gọi ĐÚNG các hàm mà preview và bản xuất dùng (`transitionStyleAt`,
 * `motionTransformAt`), nên thứ hiện trên thẻ là thứ sẽ ra video — không phải
 * một hoạt hình vẽ tay "na ná". Hàm thuần theo mili giây để kiểm được bằng số.
 */

/** Nhịp khung hình của minh hoạ, trùng nhịp mặc định của dự án. */
const PREVIEW_FPS = 30

/** Chuyển cảnh: giữ cảnh A → chạy chuyển cảnh → giữ cảnh B → lặp lại. */
const HOLD_BEFORE_MS = 400
const TRANSITION_MS = 700
const HOLD_AFTER_MS = 700
export const TRANSITION_PREVIEW_CYCLE_MS = HOLD_BEFORE_MS + TRANSITION_MS + HOLD_AFTER_MS

/** Chuyển động chạy suốt clip: một "clip" minh hoạ dài chừng này rồi lặp lại. */
export const MOTION_PREVIEW_CYCLE_MS = 1800

/**
 * Cường độ chuyển động trên thẻ: mức MẠNH NHẤT mà người dùng đặt được. Thẻ nhỏ,
 * cường độ mặc định lia vài pixel là không nhìn ra — nhưng không phóng đại quá mức
 * có thật, để thẻ không hứa một thứ video không làm được.
 */
const PREVIEW_MOTION_INTENSITY = 1

export interface LibraryCardFrame {
  /** Kiểu của cảnh B (cảnh đang hiện ra đè lên cảnh A). Chỉ có với chuyển cảnh. */
  incoming?: TransitionStyle
  /**
   * Kiểu của cảnh A — cảnh ĐANG ĐI.
   *
   * Cảnh A đứng yên thì thẻ chỉ kể được nửa câu chuyện, và với mấy kiểu mà phần
   * hay nằm hẳn ở mép ra — lấy đà rồi phóng, chìm vào đen, lia vụt — thẻ hứa một
   * đằng, video ra một nẻo.
   */
  outgoing?: TransitionStyle
  /** `transform` CSS của cảnh duy nhất. Chỉ có với chuyển động. */
  motionTransform?: string
}

export function libraryCardFrameAt(item: LibraryClipItem, elapsedMs: number): LibraryCardFrame {
  if (item.type === 'transition') {
    const t = positiveModulo(elapsedMs, TRANSITION_PREVIEW_CYCLE_MS)
    const progress = Math.min(1, Math.max(0, (t - HOLD_BEFORE_MS) / TRANSITION_MS))
    const frame = Math.floor((t / 1000) * PREVIEW_FPS)
    return {
      incoming: transitionStyleAt(item.kind, progress, frame, 'in'),
      // Cảnh đi nhận phần tiến độ còn lại, đúng như hai phía của một chỗ nối thật.
      outgoing: transitionStyleAt(item.kind, 1 - progress, frame, 'out')
    }
  }

  const durationInFrames = Math.round((MOTION_PREVIEW_CYCLE_MS / 1000) * PREVIEW_FPS)
  const frame = Math.floor(
    (positiveModulo(elapsedMs, MOTION_PREVIEW_CYCLE_MS) / 1000) * PREVIEW_FPS
  )
  return {
    motionTransform: motionTransformCss(
      motionTransformAt(
        { kind: item.kind, intensity: PREVIEW_MOTION_INTENSITY },
        frame,
        durationInFrames
      )
    )
  }
}

/**
 * Khung đứng yên khi thẻ không được rê chuột: giữa chuyển cảnh, hoặc giữa chuyển
 * động. Giữa chừng thì mỗi thẻ đã trông khác nhau — mờ, lệch, nhoè — thay vì cả
 * lưới giống hệt nhau ở khung đầu.
 */
export function libraryCardRestingFrame(item: LibraryClipItem): LibraryCardFrame {
  return item.type === 'transition'
    ? libraryCardFrameAt(item, HOLD_BEFORE_MS + TRANSITION_MS / 2)
    : // Giật phóng vào chỉ chạy ở 20% đầu rồi đứng yên, nên nghỉ ở đầu vòng.
      libraryCardFrameAt(item, MOTION_PREVIEW_CYCLE_MS * (item.kind === 'punch-in' ? 0.05 : 0.75))
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}
