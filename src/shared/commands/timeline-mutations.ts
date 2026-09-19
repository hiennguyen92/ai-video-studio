import type { Micros } from '../domain/time-units'
import { clipEndUs, clipSourceSpanUs, type Clip, type Track } from '../domain/timeline-track-types'
import { shiftKeyframes, splitKeyframes } from '../domain/keyframe-clip-edits'

/**
 * Phép biến đổi thuần trên track/clip, dùng chung cho mọi command.
 *
 * Đây là nơi DUY NHẤT giữ bất biến "clip trong một track không chồng lấn và luôn
 * sắp xếp tăng dần". Reducer chỉ gọi các hàm này, không tự sửa mảng clips.
 *
 * Chính sách khi thả clip đè lên clip cũ: GHI ĐÈ (overwrite) — giống hành vi mặc
 * định của các trình dựng phim: phần bị đè sẽ bị cắt bớt hoặc tách đôi.
 */

export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startUs - b.startUs)
}

/** Đổi mép đầu clip sang `toUs`, kéo theo sourceInUs tương ứng. */
function trimClipStart(clip: Clip, toUs: Micros): Clip {
  const delta = toUs - clip.startUs
  return {
    ...clip,
    startUs: toUs,
    durationUs: clip.durationUs - delta,
    sourceInUs: clip.sourceInUs + Math.round(delta * clip.speed),
    // Mốc keyframe tính từ mép đầu, nên dời mép đầu là dời gốc toạ độ: không trừ
    // lại thì cả chuyển động trôi đi đúng bằng đoạn vừa cắt. Mốc âm được giữ để
    // kéo mép trả ra còn khôi phục được.
    keyframes: shiftKeyframes(clip.keyframes, -delta)
  }
}

/** Đổi mép cuối clip sang `toUs`. sourceInUs giữ nguyên. */
function trimClipEnd(clip: Clip, toUs: Micros): Clip {
  return { ...clip, durationUs: toUs - clip.startUs }
}

/**
 * Dọn sạch khoảng [startUs, endUs) trên track: clip nằm trọn thì xoá, clip chớm
 * mép thì cắt bớt, clip trùm cả khoảng thì tách làm hai.
 *
 * `keepClipId` cho phép bỏ qua chính clip đang được di chuyển.
 */
export function carveOutRange(
  clips: Clip[],
  startUs: Micros,
  endUs: Micros,
  options: { keepClipId?: string; makeId: () => string }
): Clip[] {
  if (endUs <= startUs) return clips

  const result: Clip[] = []
  for (const clip of clips) {
    if (clip.id === options.keepClipId) {
      result.push(clip)
      continue
    }

    const thisEnd = clipEndUs(clip)
    const overlaps = clip.startUs < endUs && startUs < thisEnd
    if (!overlaps) {
      result.push(clip)
      continue
    }

    const coveredAtStart = clip.startUs >= startUs
    const coveredAtEnd = thisEnd <= endUs

    if (coveredAtStart && coveredAtEnd) {
      // Bị đè hoàn toàn — bỏ clip.
      continue
    }

    if (!coveredAtStart && !coveredAtEnd) {
      // Khoảng đè nằm gọn bên trong clip — tách thành hai mảnh.
      result.push(trimClipEnd(clip, startUs))
      const tail = trimClipStart(clip, endUs)
      result.push({ ...tail, id: options.makeId(), linkGroupId: undefined })
      continue
    }

    if (coveredAtStart) {
      // Đè phần đầu — đẩy mép đầu sang phải.
      result.push(trimClipStart(clip, endUs))
    } else {
      // Đè phần đuôi — kéo mép cuối sang trái.
      result.push(trimClipEnd(clip, startUs))
    }
  }

  return sortClips(result.filter((clip) => clip.durationUs > 0))
}

/**
 * Xoá hẳn khoảng [startUs, endUs) rồi KÉO mọi thứ phía sau lùi lên lấp chỗ trống.
 *
 * Khác `carveOutRange`: hàm kia để lại một lỗ hổng (dùng khi thả clip đè lên),
 * còn hàm này đóng lỗ hổng lại — đúng thao tác "cắt bỏ đoạn thừa" khi dựng phim.
 *
 * Dùng lại `carveOutRange` cho phần cắt thay vì viết lại logic tách/cắt clip:
 * đó là chỗ duy nhất giữ bất biến "clip không chồng lấn, luôn sắp xếp tăng dần".
 */
export function rippleDeleteRange(
  clips: Clip[],
  startUs: Micros,
  endUs: Micros,
  options: { makeId: () => string }
): Clip[] {
  if (endUs <= startUs) return clips

  const span = endUs - startUs
  const carved = carveOutRange(clips, startUs, endUs, options)

  return sortClips(
    carved.map((clip) =>
      // Chỉ dời phần nằm hoàn toàn sau khoảng bị xoá. Clip bị cắt đuôi thì mép
      // đầu của nó vẫn ở nguyên chỗ cũ, không được dời.
      clip.startUs >= endUs ? { ...clip, startUs: clip.startUs - span } : clip
    )
  )
}

/** Đặt clip vào track theo kiểu ghi đè. */
export function placeClip(track: Track, clip: Clip, makeId: () => string): Clip[] {
  const carved = carveOutRange(track.clips, clip.startUs, clipEndUs(clip), {
    keepClipId: clip.id,
    makeId
  })
  const withoutSelf = carved.filter((existing) => existing.id !== clip.id)
  return sortClips([...withoutSelf, clip])
}

export interface TrimLimits {
  /** Thời lượng asset nguồn; undefined nghĩa là ảnh — kéo dài bao nhiêu cũng được. */
  assetDurationUs?: Micros
  /** Độ dài tối thiểu của clip sau khi cắt. */
  minDurationUs: Micros
}

/**
 * Cắt một mép clip tới vị trí tuyệt đối `toUs`, có kẹp biên theo vật liệu nguồn.
 * Trả về clip mới, hoặc null nếu kết quả không hợp lệ.
 */
export function trimClipEdgeTo(
  clip: Clip,
  edge: 'start' | 'end',
  toUs: Micros,
  limits: TrimLimits
): Clip | null {
  if (edge === 'start') {
    const maxStart = clipEndUs(clip) - limits.minDurationUs
    // Không kéo mép đầu ra trước điểm bắt đầu của vật liệu nguồn.
    const earliestStart = clip.startUs - Math.round(clip.sourceInUs / clip.speed)
    const target = Math.min(Math.max(toUs, Math.max(0, earliestStart)), maxStart)
    if (target === clip.startUs) return clip
    const trimmed = trimClipStart(clip, target)
    return trimmed.durationUs >= limits.minDurationUs ? trimmed : null
  }

  const minEnd = clip.startUs + limits.minDurationUs
  let target = Math.max(toUs, minEnd)
  if (limits.assetDurationUs !== undefined) {
    // Không kéo mép cuối vượt quá phần vật liệu còn lại.
    const remainingSourceUs = limits.assetDurationUs - clip.sourceInUs
    const maxDuration = Math.floor(remainingSourceUs / clip.speed)
    target = Math.min(target, clip.startUs + maxDuration)
  }
  if (target <= clip.startUs) return null
  return trimClipEnd(clip, target)
}

/** Tách clip tại `atUs`. Trả về [nửa đầu, nửa sau] hoặc null nếu điểm cắt nằm ngoài. */
export function splitClipAt(clip: Clip, atUs: Micros, newId: string): [Clip, Clip] | null {
  if (atUs <= clip.startUs || atUs >= clipEndUs(clip)) return null

  // Mỗi nửa nhận một keyframe ngay tại chỗ nối, mang giá trị nội suy tại đó —
  // nếu không, giá trị nhảy bậc đúng chỗ vừa cắt và chuyển động giật một cái.
  const cutKeyframes = splitKeyframes(clip.keyframes, atUs - clip.startUs)

  const head: Clip = {
    ...clip,
    durationUs: atUs - clip.startUs,
    // Fade-out thuộc về nửa sau.
    fadeOutUs: 0,
    keyframes: cutKeyframes.head
  }
  const tail: Clip = {
    ...clip,
    id: newId,
    startUs: atUs,
    durationUs: clipEndUs(clip) - atUs,
    sourceInUs: clip.sourceInUs + Math.round((atUs - clip.startUs) * clip.speed),
    // Fade-in thuộc về nửa đầu.
    fadeInUs: 0,
    keyframes: cutKeyframes.tail,
    // Nửa sau KHÔNG ở lại nhóm của nửa đầu: ở lại thì nhóm phình thành ba clip, và
    // "cắt rồi xoá nửa hỏng" xoá luôn nửa tốt cùng tiếng đi kèm. Tách cả nhóm cho
    // đúng thì dùng `planSplitClip` — nó gom các nửa sau thành một nhóm mới.
    linkGroupId: undefined
  }

  // Fade không được dài hơn mảnh chứa nó.
  head.fadeInUs = Math.min(head.fadeInUs, head.durationUs)
  tail.fadeOutUs = Math.min(tail.fadeOutUs, tail.durationUs)
  return [head, tail]
}

/** Chỗ trống đầu tiên đủ chứa `durationUs`, tính từ `fromUs`. */
export function findFreeSlot(clips: Clip[], fromUs: Micros, durationUs: Micros): Micros {
  const sorted = sortClips(clips)
  let cursor = fromUs
  for (const clip of sorted) {
    if (clipEndUs(clip) <= cursor) continue
    if (clip.startUs >= cursor + durationUs) break
    cursor = clipEndUs(clip)
  }
  return cursor
}

/** Số microgiây nguồn mà clip đang dùng — tiện cho kiểm tra bất biến. */
export function clipConsumesSourceUs(clip: Clip): Micros {
  return clipSourceSpanUs(clip)
}
