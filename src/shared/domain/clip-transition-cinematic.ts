import type { CinematicTransitionKind } from './timeline-track-types'
import type { TransitionEdge, TransitionStyle } from './clip-transition-style'
import {
  CIRCLE_FEATHER,
  WIPE_FEATHER,
  clamp01,
  featheredMask,
  maskStopAt,
  overshootScale,
  round,
  sweep
} from './clip-transition-mask'
import {
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  easeOutQuart,
  smootherStep
} from './transition-easing'

/**
 * Nhóm chuyển cảnh "điện ảnh": mép mềm, easing riêng, vài kiểu không đối xứng.
 *
 * Tách khỏi nhóm nền vì hai nhóm khác nhau về BẢN CHẤT chứ không chỉ về số lượng.
 * Nhóm nền dịch chuyển và cắt cứng; nhóm này dùng mặt nạ có mép mềm, lớp phủ phát
 * sáng và những đường cong tiến độ mà mỗi kiểu tự chọn lấy.
 *
 * Nguồn tham chiếu: các shader hai luồng của OpenChatCut (`src/gl/shaders/`).
 * Chúng trộn thật hai texture; ở đây mỗi clip chỉ vẽ được phần của chính nó, nên
 * thứ thay cho phép trộn là hai mặt nạ BÙ NHAU — xem `sweep` bên dưới.
 */

export function cinematicTransitionStyleAt(
  kind: CinematicTransitionKind,
  progress: number,
  frame: number,
  edge: TransitionEdge
): TransitionStyle {
  // Hết chuyển cảnh thì KHÔNG để lại dấu vết nào: một bộ lọc `blur(0px)` còn sót
  // vẫn đẩy clip sang lớp vẽ riêng và làm lệch màu so với clip không chuyển cảnh.
  if (progress >= 1) return { opacity: 1 }

  switch (kind) {
    case 'soft-wipe-left':
    case 'soft-wipe-right': {
      const toward = kind === 'soft-wipe-left' ? 'to left' : 'to right'
      const amount = easeInOutCubic(sweep(progress, edge))
      const drift = (edge === 'in' ? 1 - amount : amount) * 2
      const sign = (kind === 'soft-wipe-left' ? 1 : -1) * (edge === 'in' ? 1 : -1)
      return {
        opacity: 1,
        maskImage: featheredMask(
          toward,
          maskStopAt(amount, WIPE_FEATHER),
          WIPE_FEATHER,
          edge === 'out'
        ),
        // Hai phía lệch nhau một quãng không đổi: mép mềm mà hai cảnh đứng yên
        // thì trông như một tấm kính mờ kéo qua chứ không như hai cảnh rời nhau.
        // Quãng lệch nhỏ hơn bề rộng mép mềm nên nó chỉ làm chỗ giao dày thêm,
        // không hở ra.
        transform: `translateX(${round(sign * drift)}%)`
      }
    }

    case 'circle-open': {
      const amount = easeInOutCubic(sweep(progress, edge))
      return {
        opacity: 1,
        maskImage: featheredMask(
          'circle',
          maskStopAt(amount, CIRCLE_FEATHER),
          CIRCLE_FEATHER,
          edge === 'out'
        )
      }
    }

    case 'line-wipe': {
      // Mép quét chạy từ trái sang phải; clip đến giữ phần bên trái mép, clip đi
      // giữ phần bên phải. Cắt CỨNG — vệt sáng mới là thứ giấu chỗ nối, không phải mép mềm.
      const at = smootherStep(sweep(progress, edge)) * 100
      const clipPath =
        edge === 'in' ? `inset(0 ${round(100 - at)}% 0 0)` : `inset(0 0 0 ${round(at)}%)`
      return {
        opacity: 1,
        clipPath,
        overlay: `linear-gradient(to right, #0000 ${round(at - 1.4)}%, #ffffffe6 ${round(at)}%, #0000 ${round(at + 1.4)}%)`
      }
    }

    case 'dip-to-black': {
      // Cả hai phía đều tắt hẳn trong khoảng giữa, để lộ nền project. Ngưỡng 0.6
      // cho mỗi phía nghĩa là 20% quãng giữa không clip nào hiện — đúng khoảng
      // nghỉ mà một cú chìm vào đen cần có.
      return { opacity: smootherStep(clamp01((progress - 0.6) / 0.4)) }
    }

    case 'impact': {
      // Mạnh nhất ở GIỮA chuyển cảnh, chỗ hai clip đổi vai. Rung theo khung hình
      // chứ không theo tiến độ: nội suy mượt thì thành một cú lắc chứ không phải cú đấm.
      const blow = (1 - Math.abs(progress * 2 - 1)) ** 3
      const shakeX = Math.sin(frame * 11.3) * blow * 2.4
      const shakeY = Math.cos(frame * 9.7) * blow * 1.8
      return {
        // Đổi clip dứt khoát ở giữa: cú đấm không có chỗ cho mờ chồng.
        opacity: progress < 0.5 ? 0 : 1,
        transform: `translate(${round(shakeX)}%, ${round(shakeY)}%) scale(${round(1 + blow * 0.09)})`,
        filter: `brightness(${round(1 + blow ** 2 * 0.55)})`
      }
    }

    case 'punch-zoom': {
      if (edge === 'in') {
        // Vào từ hơi nhỏ rồi nở ra, và chỉ hiện dần ở nửa sau — hiện sớm là che
        // mất cú phóng của clip đi, mà cú phóng đó mới là phần đáng xem.
        return {
          opacity: smootherStep(clamp01((progress - 0.4) / 0.45)),
          transform: `scale(${round(0.82 + 0.18 * easeOutQuart(progress))})`
        }
      }
      // Lấy đà (thụt nhẹ) rồi phóng vọt kèm nhoè.
      const elapsed = 1 - progress
      const windup = elapsed < 0.3 ? Math.sin((elapsed / 0.3) * Math.PI) : 0
      const punch = elapsed >= 0.3 ? ((elapsed - 0.3) / 0.7) ** 3 : 0
      return {
        opacity: 1 - smootherStep(clamp01((elapsed - 0.45) / 0.55)),
        transform: `scale(${round(1 - windup * 0.06 + punch * 1.6)})`,
        filter: `blur(${round(punch * 24)}px)`
      }
    }

    case 'rack-focus': {
      // Đảo nét: nhoè kèm tụt tương phản và độ bão hoà. Chỉ nhoè không thôi trông
      // như ống kính bẩn; ống kính lạc nét thì màu cũng nhạt đi.
      const amount = easeOutCubic(progress)
      const soft = 1 - amount
      return {
        opacity: amount,
        filter: `blur(${round(soft * 20)}px) contrast(${round(1 - soft * 0.3)}) saturate(${round(1 - soft * 0.35)})`
      }
    }

    case 'luma-blend': {
      // Mờ chồng có cộng sáng: đỉnh sáng rơi đúng giữa chuyển cảnh, nơi hai clip
      // chồng nhau nhiều nhất, nên chỗ giao bùng lên thay vì xám lại.
      const glow = 4 * progress * (1 - progress)
      return {
        opacity: easeOutCubic(progress),
        filter: `brightness(${round(1 + glow * 0.5)}) saturate(${round(1 + glow * 0.18)})`
      }
    }

    case 'whip-up':
    case 'whip-down': {
      // Cùng chiều ở hai phía: máy lia lên thì cảnh cũ trôi lên và ra khỏi khung,
      // cảnh mới vào từ dưới. Nảy lại một nhịp ở cuối cho ra cảm giác ghìm máy.
      const offset = (1 - easeOutBack(progress, 0.3)) * 130
      const sign = (kind === 'whip-up' ? 1 : -1) * (edge === 'in' ? 1 : -1)
      return {
        opacity: 1,
        // Phóng thêm một chút trong quãng NẢY. Lúc nảy, clip vượt qua vị trí nghỉ
        // trong khi clip kia đã đi xa, nên mép đối diện hở ra một vệt mỏng — vài
        // pixel, nhưng là nền trống nên vẫn thấy.
        transform: `translateY(${round(sign * offset)}%) scale(${overshootScale(offset)})`,
        filter: `blur(${round((1 - easeOutCubic(progress)) * 16)}px)`
      }
    }
  }
}
