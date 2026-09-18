import { resolveKeyframeTrack, valueAtFrame } from './keyframe-interpolation'
import { normalizeKeyframeTrack, type Keyframe, type KeyframeTracks } from './keyframe-types'
import { parseEffectPath } from './keyframe-property-catalog'
import type { ClipEffect } from './clip-effect-types'
import type { Micros } from './time-units'

/**
 * Keyframe đi theo clip khi clip bị sửa.
 *
 * Mốc keyframe tính từ MÉP ĐẦU clip, nên phần lớn thao tác không phải làm gì:
 * kéo clip sang chỗ khác, trượt vật liệu nguồn, cắt mép cuối — gốc toạ độ không
 * đổi thì keyframe cũng không đổi. Chỉ ba thao tác thật sự dời gốc hoặc đổi
 * thang thời gian mới cần ở đây, và mỗi hàm bên dưới là một trong ba cái đó.
 *
 * Toàn bộ là hàm THUẦN, không biết gì về reducer hay immer: nhận mảng, trả mảng
 * mới. Reducer chỉ việc gán kết quả.
 */

/**
 * Thang giả để `resolveKeyframeTrack` giữ nguyên MICRO GIÂY thay vì quy về khung
 * hình: một "khung" dài đúng một micro giây.
 *
 * Phần đánh giá chỉ cần hai trục cùng đơn vị, không cần đơn vị đó là khung. Nhờ
 * vậy chỗ tách clip không phải biết fps của dự án, mà vẫn dùng lại đúng một hàm
 * nội suy với lớp vẽ — hai bên không thể cho ra hai giá trị khác nhau ở chỗ nối.
 */
const MICROS_AS_FRAMES = { num: 1_000_000, den: 1 }

/** Có thuộc tính nào đang chạy keyframe không. */
export function hasAnyKeyframe(subject: { keyframes?: KeyframeTracks }): boolean {
  const tracks = subject.keyframes
  if (!tracks) return false
  for (const path of Object.keys(tracks)) {
    if ((tracks[path]?.length ?? 0) > 0) return true
  }
  return false
}

/** Bản sao sâu, để hai clip không bao giờ dùng chung một mảng keyframe. */
export function cloneKeyframes(tracks: KeyframeTracks | undefined): KeyframeTracks | undefined {
  if (!tracks) return undefined
  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    result[path] = tracks[path].map((frame) => ({ ...frame }))
  }
  return result
}

/** Bỏ những đường rỗng; hết sạch thì trả `undefined` để tài liệu không mang khoá thừa. */
export function compactKeyframes(tracks: KeyframeTracks | undefined): KeyframeTracks | undefined {
  if (!tracks) return undefined
  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    if (tracks[path]?.length) result[path] = tracks[path]
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Dời mọi mốc đi `deltaUs` — dùng khi MÉP ĐẦU clip dời, tức gốc toạ độ dời.
 *
 * Mốc âm được GIỮ, không xoá. Cắt mép là thao tác đảo được: kéo mép vào rồi kéo
 * trả ra phải thấy chuyển động y như cũ. Xoá lúc cắt thì không khôi phục nổi,
 * và lịch sử hoàn tác không cứu được nếu người dùng đã làm mười việc khác ở
 * giữa. Phần đánh giá kẹp hai đầu nên mốc nằm ngoài clip vô hại về hình.
 */
export function shiftKeyframes(
  tracks: KeyframeTracks | undefined,
  deltaUs: Micros
): KeyframeTracks | undefined {
  if (!tracks || deltaUs === 0) return tracks
  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    result[path] = tracks[path].map((frame) => ({ ...frame, atUs: frame.atUs + deltaUs }))
  }
  return result
}

/**
 * Co giãn mọi mốc theo tỉ lệ độ dài — dùng khi đổi tốc độ hoặc kéo giãn nhịp.
 *
 * Keyframe đặt "ở cuối clip" phải vẫn ở cuối clip sau khi clip phát nhanh gấp
 * đôi. Không co giãn thì mọi chuyển động dồn về nửa đầu và nửa sau đứng hình.
 */
export function scaleKeyframes(
  tracks: KeyframeTracks | undefined,
  fromDurationUs: Micros,
  toDurationUs: Micros
): KeyframeTracks | undefined {
  if (!tracks || fromDurationUs <= 0 || fromDurationUs === toDurationUs) return tracks
  const ratio = toDurationUs / fromDurationUs
  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    result[path] = tracks[path].map((frame) => ({
      ...frame,
      atUs: Math.round(frame.atUs * ratio)
    }))
  }
  return result
}

/**
 * Tách các đường keyframe tại `cutUs` (offset từ mép đầu clip).
 *
 * Mỗi nửa được CHÈN một keyframe ngay tại chỗ nối, mang đúng giá trị nội suy ở
 * điểm cắt. Không chèn thì nửa đầu kết thúc ở keyframe cuối cùng trước điểm cắt
 * rồi giữ nguyên giá trị đó, còn nửa sau bắt đầu ở keyframe đầu tiên sau điểm
 * cắt — giá trị NHẢY BẬC đúng chỗ nối, và cắt một clip xong thấy chuyển động
 * giật một cái là lỗi ai cũng thấy.
 *
 * Giá trị chèn lấy bằng chính hàm đánh giá của lớp vẽ, nên chỗ nối khớp đúng
 * thứ người dùng vừa nhìn thấy trước khi cắt.
 */
export function splitKeyframes(
  tracks: KeyframeTracks | undefined,
  cutUs: Micros
): { head: KeyframeTracks | undefined; tail: KeyframeTracks | undefined } {
  if (!tracks) return { head: undefined, tail: undefined }

  const head: KeyframeTracks = {}
  const tail: KeyframeTracks = {}

  for (const path of Object.keys(tracks)) {
    const track = tracks[path]
    if (!track.length) continue

    const spansCut =
      track.some((frame) => frame.atUs < cutUs) && track.some((frame) => frame.atUs > cutUs)
    // Đánh giá tại điểm cắt bằng thang MICRO GIÂY: `valueAtFrame` chỉ cần hai
    // trục cùng đơn vị, không nhất thiết phải là khung hình. Làm vậy thì chỗ này
    // không phải biết fps của dự án.
    const valueAtCut = valueAtFrame(resolveKeyframeTrack(track, MICROS_AS_FRAMES), cutUs, 0)

    const headTrack: Keyframe[] = track.filter((frame) => frame.atUs <= cutUs)
    const tailTrack: Keyframe[] = track
      .filter((frame) => frame.atUs >= cutUs)
      .map((frame) => ({ ...frame, atUs: frame.atUs - cutUs }))

    if (spansCut) {
      // Easing của keyframe ngay trước điểm cắt cũng chi phối đoạn đi tới điểm
      // cắt, nên mang nó sang để đoạn trước chỗ nối giữ đúng dáng.
      const before = [...track].reverse().find((frame) => frame.atUs < cutUs)
      headTrack.push({ atUs: cutUs, v: valueAtCut, e: before?.e })
      tailTrack.unshift({ atUs: 0, v: valueAtCut, e: before?.e })
    }

    if (headTrack.length) head[path] = normalizeKeyframeTrack(headTrack)
    if (tailTrack.length) tail[path] = normalizeKeyframeTrack(tailTrack)
  }

  return { head: compactKeyframes(head), tail: compactKeyframes(tail) }
}

/**
 * Dọn keyframe của những effect KHÔNG còn trong chồng effect mới.
 *
 * Đây là nguồn mồ côi duy nhất trong cả hệ: clip và khối chữ mang keyframe
 * trong chính mình nên xoá chúng là xoá luôn keyframe, còn effect thì bị thay
 * CẢ MẢNG bằng một lệnh. Không dọn thì file lớn dần bằng dữ liệu không ai đọc,
 * và tệ hơn: gỡ một effect rồi thêm lại đúng id đó sẽ thấy chuyển động cũ sống
 * lại một cách khó hiểu.
 */
export function pruneEffectKeyframes(
  tracks: KeyframeTracks | undefined,
  effects: readonly ClipEffect[] | undefined
): KeyframeTracks | undefined {
  if (!tracks) return undefined
  const alive = new Set((effects ?? []).map((effect) => effect.id))
  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    const effectPath = parseEffectPath(path)
    if (effectPath && !alive.has(effectPath.effectId)) continue
    result[path] = tracks[path]
  }
  return compactKeyframes(result)
}
