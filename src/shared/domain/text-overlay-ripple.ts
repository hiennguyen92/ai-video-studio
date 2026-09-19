import { splitKeyframes } from './keyframe-clip-edits'
import type { KeyframeTracks } from './keyframe-types'
import type { TextOverlay } from './text-overlay-types'
import type { Micros } from './time-units'

/**
 * Chữ overlay khi cắt bỏ khoảng `[fromUs, toUs)` và dồn phần sau lên.
 *
 * Ripple xoá trước đây dời clip, câu phụ đề và marker nhưng BỎ QUÊN chữ overlay:
 * cắt khoảng lặng trên cả video hay dựng cut từ transcript xong, dòng chữ "Giảm
 * 50%" vẫn đứng ở giây cũ và rơi lên cảnh khác hẳn.
 *
 * Đầu và cuối chữ đi qua cùng một phép quy đổi thời gian: trước khoảng giữ
 * nguyên, trong khoảng dồn về `fromUs`, sau khoảng lùi đúng độ dài khoảng. Chữ
 * nằm trọn trong khoảng thì mất theo, như câu phụ đề.
 */
export function rippleTextOverlays(
  overlays: readonly TextOverlay[],
  fromUs: Micros,
  toUs: Micros
): TextOverlay[] {
  const span = toUs - fromUs
  const remap = (atUs: Micros): Micros =>
    atUs <= fromUs ? atUs : atUs >= toUs ? atUs - span : fromUs

  const result: TextOverlay[] = []
  for (const overlay of overlays) {
    if (overlay.startUs >= fromUs && overlay.endUs <= toUs) continue
    const moved: TextOverlay = {
      ...overlay,
      startUs: remap(overlay.startUs),
      endUs: remap(overlay.endUs)
    }
    const cutsInside = overlay.startUs < toUs && overlay.endUs > fromUs
    if (overlay.keyframes && cutsInside) {
      moved.keyframes = cutKeyframes(
        overlay.keyframes,
        fromUs - overlay.startUs,
        toUs - overlay.startUs
      )
    }
    result.push(moved)
  }
  return result
}

/**
 * Bỏ khoảng `[fromRel, toRel)` (tính từ mép đầu chữ) khỏi các đường keyframe.
 *
 * Chỗ nối phải là một cú NHẢY, không phải một đoạn nội suy mới: trước mốc cắt,
 * chuyển động giữ đúng như cũ và kết thúc ở giá trị tại `fromRel`; từ mốc cắt trở
 * đi, nó tiếp tục từ giá trị tại `toRel`. Trước đây keyframe trong khoảng cắt bị
 * dồn về cùng một mốc và bản sau đè bản trước — đoạn TRƯỚC khoảng cắt đổi dáng
 * (một chữ đang đứng yên bỗng mờ dần lên), dù người dùng không cắt gì ở đó.
 *
 * Hai mốc ở chỗ nối cách nhau 1 µs: cùng rơi vào một khung thì `valueAtFrame` nội
 * suy tới mốc đầu rồi lấy mốc sau — đúng một cú nhảy.
 */
function cutKeyframes(tracks: KeyframeTracks, fromRel: Micros, toRel: Micros): KeyframeTracks {
  const fromClamped = Math.max(0, fromRel)
  const { head, tail: rest } = splitKeyframes(tracks, fromClamped)
  const { tail: after } = splitKeyframes(rest, toRel - fromClamped)

  const result: KeyframeTracks = {}
  for (const path of Object.keys(tracks)) {
    // Chữ bắt đầu NGAY TRONG khoảng cắt thì không còn phần "trước" nào.
    const before = fromRel > 0 ? (head?.[path] ?? []) : []
    const later = after?.[path] ?? []
    const joined = [
      ...before,
      ...later.map((frame, index) => ({
        ...frame,
        atUs: fromClamped + frame.atUs + (index === 0 && before.length > 0 ? 1 : 0)
      }))
    ]
    if (joined.length > 0) result[path] = joined
  }
  return result
}
