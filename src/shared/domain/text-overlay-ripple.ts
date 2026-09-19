import { normalizeKeyframeTrack, type KeyframeTracks } from './keyframe-types'
import type { TextOverlay } from './text-overlay-types'
import type { Micros } from './time-units'

/**
 * Chữ overlay khi cắt bỏ khoảng `[fromUs, toUs)` và dồn phần sau lên.
 *
 * Ripple xoá trước đây dời clip, câu phụ đề và marker nhưng BỎ QUÊN chữ overlay:
 * cắt khoảng lặng trên cả video hay dựng cut từ transcript xong, dòng chữ "Giảm
 * 50%" vẫn đứng ở giây cũ và rơi lên cảnh khác hẳn.
 *
 * Mọi mốc — đầu, cuối, từng keyframe — đi qua CÙNG một phép quy đổi thời gian:
 * trước khoảng giữ nguyên, trong khoảng dồn về `fromUs`, sau khoảng lùi đúng độ
 * dài khoảng. Chữ nằm trọn trong khoảng thì mất theo, như câu phụ đề.
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
    const startUs = remap(overlay.startUs)
    const endUs = remap(overlay.endUs)
    const moved: TextOverlay = { ...overlay, startUs, endUs }
    if (overlay.keyframes) {
      // Keyframe tính từ MÉP ĐẦU chữ: quy về giờ tuyệt đối, đổi, rồi trừ mép đầu mới.
      const keyframes: KeyframeTracks = {}
      for (const [path, track] of Object.entries(overlay.keyframes)) {
        // Keyframe nằm trong khoảng cắt dồn về cùng một mốc; chuẩn hoá để giữ bất
        // biến "mỗi mốc một keyframe" mà phần đánh giá dựa vào.
        keyframes[path] = normalizeKeyframeTrack(
          track.map((frame) => ({ ...frame, atUs: remap(overlay.startUs + frame.atUs) - startUs }))
        )
      }
      moved.keyframes = keyframes
    }
    result.push(moved)
  }
  return result
}
