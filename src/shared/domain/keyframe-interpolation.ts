import { frameOfMicros, type FrameRate } from './time-units'
import type {
  Keyframe,
  KeyframeEasing,
  ResolvedKeyframe,
  ResolvedKeyframeTrack
} from './keyframe-types'

/**
 * Đánh giá một đường keyframe tại một khung hình.
 *
 * Hàm THUẦN theo khung: khung thứ N luôn cho ra cùng một kết quả, dù đang tua
 * trên bản xem trước hay đang xuất file. Đây là hợp đồng mà `motionTransformAt`
 * và `transitionStyleAt` đã theo, và nó là thứ duy nhất giữ cho preview với bản
 * xuất không lệch nhau — hai bên chạy cùng một hàm này trên cùng một con số.
 *
 * Quy đổi micro giây → khung xảy ra MỘT LẦN, ở `resolveKeyframeTrack`, lúc dựng
 * kế hoạch vẽ. Vòng vẽ chỉ so số nguyên khung.
 */

/**
 * Đường cong easing, bậc hai.
 *
 * Bậc hai chứ không cubic-bezier: đủ cho cảm giác vào/ra mềm, mỗi kiểu một dòng,
 * và kiểm được bằng con số chính xác (`ease-in` tại giữa đoạn cho đúng 0,25 biên
 * độ). Cubic-bezier cần bộ giải Newton lặp — thêm một chỗ sai được, mà mắt
 * thường không phân biệt nổi trên một cú kéo dài nửa giây.
 */
export function easeProgress(t: number, easing: KeyframeEasing): number {
  switch (easing) {
    case 'hold':
      // Giữ nguyên giá trị bên trái cho tới khi chạm đúng keyframe bên phải.
      return 0
    case 'ease-in':
      return t * t
    case 'ease-out':
      return 1 - (1 - t) * (1 - t)
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)
    case 'linear':
      return t
  }
}

/**
 * Giá trị của đường keyframe tại `frame`.
 *
 * `fallback` là giá trị TĨNH đang lưu trên clip: không có keyframe nào thì mọi
 * thứ phải y hệt như trước khi có tính năng này.
 *
 * Một keyframe duy nhất KHÓA CỨNG giá trị cho cả clip, không phải "chưa động
 * gì". Bấm nút kim cương một lần là người dùng đã tuyên bố "chỗ này giá trị là
 * đây", và đó cũng là cách CapCut với Premiere hiểu.
 *
 * Ngoài hai đầu thì kẹp — cùng lối `extrapolateLeft/Right: 'clamp'` mà
 * `project-composition.tsx` đang dùng cho mọi `interpolate`.
 *
 * Viết bằng vòng `for` chỉ số, không gọi `find`/`filter`/`slice`: hàm này chạy
 * mỗi khung hình cho MỖI thuộc tính có keyframe, và rác cấp phát dồn lại đủ làm
 * Player tụt khung.
 */
export function valueAtFrame(
  frames: ResolvedKeyframeTrack | undefined,
  frame: number,
  fallback: number
): number {
  if (!frames || frames.length === 0) return fallback
  if (frames.length === 1) return frames[0].v
  if (frame <= frames[0].f) return frames[lastIndexAtFrame(frames, 0)].v

  const last = frames[frames.length - 1]
  if (frame >= last.f) return last.v

  for (let index = 0; index < frames.length - 1; index += 1) {
    const left = frames[index]
    const right = frames[index + 1]
    if (frame < left.f || frame > right.f) continue

    // ĐỨNG ĐÚNG trên keyframe phải thì lấy thẳng giá trị của nó, không nội suy.
    //
    // Hai thứ cùng hỏng nếu thiếu nhánh này. Một: `hold` tính ra tiến độ 0 ở mọi
    // `t`, kể cả `t = 1`, nên giá trị sẽ không bao giờ nhảy ở các đoạn giữa —
    // đúng thứ `hold` sinh ra để làm. Hai: hai keyframe cùng rơi vào một khung
    // thì phép chia bên dưới ra NaN, mà NaN lọt vào CSS là clip biến mất không
    // một lời báo nào.
    if (frame === right.f) return frames[lastIndexAtFrame(frames, index + 1)].v

    const t = (frame - left.f) / (right.f - left.f)
    // Easing lấy từ keyframe TRÁI: nó mô tả đoạn đi TỪ nó TỚI keyframe phải.
    // Lấy từ phải thì `hold` mất tác dụng — giá trị vẫn trôi dần suốt đoạn rồi
    // mới đứng yên.
    return left.v + (right.v - left.v) * easeProgress(t, left.e)
  }

  return last.v
}

/**
 * Chỉ số của keyframe CUỐI CÙNG nằm trên cùng khung với `frames[index]`.
 *
 * Nhiều mốc micro giây khác nhau vẫn quy về một khung khi fps thấp. Lúc đó bản
 * đặt sau thắng — cùng luật với `normalizeKeyframeTrack` khi trùng `atUs`, và
 * nhờ vậy giá trị tại khung đó nối liền với đoạn đi ra, không bị hụt một khung.
 */
function lastIndexAtFrame(frames: ResolvedKeyframeTrack, index: number): number {
  let result = index
  while (result + 1 < frames.length && frames[result + 1].f === frames[index].f) result += 1
  return result
}

/**
 * Quy đổi một đường keyframe từ micro giây sang khung hình.
 *
 * `leadInFrames` bù cho việc `<Sequence>` của một clip CÓ CHUYỂN CẢNH bắt đầu
 * sớm hơn mép clip (`fromFrame = startFrame − transitionFrames`, xem
 * `remotion-render-plan.ts`). `useCurrentFrame()` đếm từ `fromFrame`, còn `atUs`
 * đếm từ mép clip — không cộng bù thì cả chuyển động chạy sớm đúng bằng độ dài
 * chuyển cảnh (0,5 giây ở cấu hình mặc định 30fps).
 *
 * Đầu vào phải ĐÃ chuẩn hoá (`normalizeKeyframeTrack`), nên ở đây không sắp lại.
 */
export function resolveKeyframeTrack(
  track: readonly Keyframe[] | undefined,
  fps: FrameRate,
  leadInFrames = 0
): ResolvedKeyframeTrack | undefined {
  if (!track || track.length === 0) return undefined
  const resolved: ResolvedKeyframeTrack = []
  for (const frame of track) {
    const next: ResolvedKeyframe = {
      f: frameOfMicros(frame.atUs, fps) + leadInFrames,
      v: frame.v,
      e: frame.e ?? 'linear'
    }
    resolved.push(next)
  }
  return resolved
}
