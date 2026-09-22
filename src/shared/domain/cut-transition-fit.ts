import { CUT_JOIN_TOLERANCE_US } from './timeline-cut-transitions'
import { clipEndUs, type Clip } from './timeline-track-types'
import { frameOfMicros, type FrameRate } from './time-units'

/**
 * Số khung chuyển cảnh CHẠY ĐƯỢC THẬT ở mỗi mép clip.
 *
 * Chuyển cảnh ở đây không nén timeline: clip đến bắt đầu SỚM hơn đúng bằng thời
 * lượng chuyển cảnh và tiêu thụ phần nguồn nằm TRƯỚC điểm vào của nó — cái mà các
 * trình dựng phim gọi là *handle*. Clip vừa nhập, chưa cắt đầu thì `sourceInUs`
 * bằng 0: không còn gì phía trước để lấn, nên hiệu ứng vào bị kẹp về 0 khung.
 *
 * Trước đây mỗi mép tự kẹp lấy phần mình, không nhìn sang mép kia. Hậu quả ở chỗ
 * nối phổ biến nhất — hai clip nhập vào đặt liền nhau: clip đi chạy trọn hiệu ứng
 * ra và trượt khỏi khung, clip đến thì không lấn được nên chưa xuất hiện, và giữa
 * hai clip là một mảng NỀN TRỐNG chiếm quá nửa khung hình.
 *
 * Nên hai mép của cùng một chỗ nối phải dùng CHUNG một con số, lấy cái nhỏ hơn.
 * Còn 6 trên 15 khung thì chạy 6 khung — ngắn nhưng kín khung. Không còn khung nào
 * thì không chạy gì, và giao diện phải nói ra (xem `junctionShortfall`), vì kẹp
 * im lặng là thứ đã giấu lỗi này suốt.
 */
export interface TrackTransitionFrames {
  /** Số khung của hiệu ứng VÀO, theo id clip. Không có nghĩa là 0. */
  enter: ReadonlyMap<string, number>
  /** Số khung của hiệu ứng RA, theo id clip. */
  exit: ReadonlyMap<string, number>
}

/** Hai clip có đứng sát nhau thành một chỗ nối không. */
function isAdjacent(left: Clip, right: Clip): boolean {
  return Math.abs(right.startUs - clipEndUs(left)) <= CUT_JOIN_TOLERANCE_US
}

/**
 * Số khung hiệu ứng VÀO mà RIÊNG clip này cho phép, chưa nhìn sang mép kia.
 *
 * Ba giới hạn, lấy cái nhỏ nhất: phần nguồn còn phía trước, vị trí trên timeline
 * (không lùi qua mốc 0), và độ dài chính clip.
 */
export function ownEnterFrames(clip: Clip, fps: FrameRate, unlimitedHandle: boolean): number {
  if (!clip.transitionIn) return 0
  const wanted = frameOfMicros(clip.transitionIn.durationUs, fps)
  if (wanted <= 0) return 0

  // Nguồn tiêu thụ nhanh hơn khi clip chạy nhanh, nên quy đổi theo tốc độ phát.
  // Ảnh tĩnh không có "phần nguồn trước điểm vào" — nó đứng yên, lấy bao nhiêu
  // khung phía trước cũng được.
  const handleFrames = unlimitedHandle
    ? Number.MAX_SAFE_INTEGER
    : Math.floor(frameOfMicros(clip.sourceInUs, fps) / Math.max(clip.speed, 0.01))
  const startFrame = frameOfMicros(clip.startUs, fps)
  const clipFrames = frameOfMicros(clipEndUs(clip), fps) - startFrame

  return Math.max(0, Math.min(wanted, handleFrames, startFrame, clipFrames))
}

/**
 * Số khung hiệu ứng RA mà riêng clip này cho phép.
 *
 * Kẹp theo NỬA thời lượng dựng của clip (đã tính cả phần lấn của hiệu ứng vào):
 * hai hiệu ứng chiếm trọn clip thì nó không bao giờ đứng yên ở trạng thái nhìn được.
 */
export function ownExitFrames(clip: Clip, fps: FrameRate, enterFrames: number): number {
  if (!clip.transitionOut) return 0
  const wanted = frameOfMicros(clip.transitionOut.durationUs, fps)
  const startFrame = frameOfMicros(clip.startUs, fps)
  const clipFrames = frameOfMicros(clipEndUs(clip), fps) - startFrame
  return Math.max(0, Math.min(wanted, Math.floor((clipFrames + enterFrames) / 2)))
}

/** Số khung của hai mép mọi clip trên một track, đã kẹp chung ở từng chỗ nối. */
export function trackTransitionFrames(
  clips: readonly Clip[],
  fps: FrameRate,
  unlimitedHandle = false
): TrackTransitionFrames {
  const sorted = [...clips].sort((left, right) => left.startUs - right.startUs)
  const enter = new Map<string, number>()
  const exit = new Map<string, number>()
  for (const clip of sorted) {
    const own = ownEnterFrames(clip, fps, unlimitedHandle)
    enter.set(clip.id, own)
    exit.set(clip.id, ownExitFrames(clip, fps, own))
  }

  // Lặp tới khi đứng yên. Hạ hiệu ứng vào làm clip ngắn lại, mà mức trần của hiệu
  // ứng ra tính theo nửa độ dài ấy — nên một lần hạ có thể kéo theo lần sau. Mọi
  // giá trị chỉ đi xuống và chặn dưới ở 0, nên vòng lặp chắc chắn dừng.
  for (let round = 0; round <= sorted.length; round++) {
    let changed = false
    for (let index = 0; index + 1 < sorted.length; index++) {
      const left = sorted[index]
      const right = sorted[index + 1]
      // Chỉ kẹp chung khi CẢ HAI mép cùng mang chuyển cảnh, tức đây thật sự là
      // chuyển cảnh của chỗ nối. Một mép lẻ từ dự án cũ là chuyện riêng của nó —
      // mờ vào nền là thứ người dùng đã đặt, không phải lỗi để đi sửa.
      if (!left.transitionOut || !right.transitionIn || !isAdjacent(left, right)) continue
      const common = Math.min(enter.get(right.id) ?? 0, exit.get(left.id) ?? 0)
      if (common !== enter.get(right.id) || common !== exit.get(left.id)) changed = true
      enter.set(right.id, common)
      exit.set(left.id, common)
    }
    for (const clip of sorted) {
      const capped = Math.min(
        exit.get(clip.id) ?? 0,
        ownExitFrames(clip, fps, enter.get(clip.id) ?? 0)
      )
      if (capped !== exit.get(clip.id)) changed = true
      exit.set(clip.id, capped)
    }
    if (!changed) break
  }

  return { enter, exit }
}

/**
 * Chuyển cảnh ở chỗ nối này bị cắt ngắn bao nhiêu so với thời lượng người dùng đặt.
 *
 * `0` là chạy đủ. Giao diện dùng số này để nói ra chuyện bị kẹp — người dùng kéo
 * thẻ vào, thấy tên chuyển cảnh hiện trong Inspector, mà video ra lại không có gì:
 * không nói thì họ tưởng ứng dụng hỏng.
 */
export function junctionShortfall(
  leftClip: Clip | undefined,
  rightClip: Clip | undefined,
  fps: FrameRate,
  unlimitedHandle = false
): { wantedFrames: number; frames: number } {
  const clips = [leftClip, rightClip].filter((clip): clip is Clip => clip !== undefined)
  const { enter, exit } = trackTransitionFrames(clips, fps, unlimitedHandle)
  const wantedUs = Math.max(
    leftClip?.transitionOut?.durationUs ?? 0,
    rightClip?.transitionIn?.durationUs ?? 0
  )
  const sides = [
    rightClip ? (enter.get(rightClip.id) ?? 0) : undefined,
    leftClip ? (exit.get(leftClip.id) ?? 0) : undefined
  ].filter((value): value is number => value !== undefined)
  return { wantedFrames: frameOfMicros(wantedUs, fps), frames: Math.min(...sides) }
}
