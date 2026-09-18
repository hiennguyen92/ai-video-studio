import { findClipEffect } from './clip-effect-catalog'
import { DEFAULT_CLIP_TRANSFORM, type Clip } from './timeline-track-types'
import type { TextOverlay } from './text-overlay-types'

/**
 * Danh mục thuộc tính đặt keyframe được.
 *
 * Một chỗ duy nhất trả lời ba câu: đường dẫn nào hợp lệ, giá trị nằm trong
 * khoảng nào, và khi KHÔNG có keyframe thì lấy số tĩnh nào làm nền. Thiếu bảng
 * này thì ba câu đó sẽ được trả lời lại ở lệnh, ở chỗ vẽ và ở giao diện — ba bản
 * sao trôi khỏi nhau, và thứ trôi là khoảng giá trị, tức là hình bị hỏng.
 *
 * Đường dẫn là CHUỖI PHẲNG, không bao giờ dùng làm khoá ghi lồng vào object
 * thật: nó chỉ là khoá tra trong `KeyframeTracks`. Nhờ vậy một đường dẫn bịa ra
 * từ agent hay từ file sửa tay không thể chạm tới `__proto__`.
 *
 * Khoảng giá trị của effect đọc THẲNG từ danh mục effect, không chép lại lần
 * hai: hai bản sao của cùng một khoảng là chuyện sớm muộn cũng lệch.
 */

/**
 * Thuộc tính của clip hình, ngoài effect.
 *
 * Khoảng ở đây CHẶT HƠN `clipTransformSchema` (editor-command-types.ts:28), chỗ
 * chỉ chặn `opacity` và đòi `scale` dương. Chặt hơn là có chủ ý: giá trị tĩnh
 * sai một lần thì người dùng thấy ngay và sửa ngay, còn một keyframe `scale:
 * 500` nằm giữa clip chỉ lộ ra khi tua tới đúng chỗ đó — mà lúc đó nó đã nằm
 * trong file xuất rồi. Bốn lần khung hình đủ cho mọi cú phóng có nghĩa.
 */
const CLIP_PROPERTIES: Record<string, { min: number; max: number }> = {
  'transform.x': { min: -4, max: 4 },
  'transform.y': { min: -4, max: 4 },
  'transform.scale': { min: 0.05, max: 8 },
  'transform.rotationDeg': { min: -360, max: 360 },
  'transform.opacity': { min: 0, max: 1 }
}

/**
 * Thuộc tính của chữ overlay.
 *
 * `style.position.*` là tỉ lệ khung hình 0..1; cho phép ra ngoài một chút để
 * chữ trượt được từ ngoài mép vào — đúng thứ người ta hay làm với hook.
 */
const TEXT_PROPERTIES: Record<string, { min: number; max: number }> = {
  'style.position.xPct': { min: -1, max: 2 },
  'style.position.yPct': { min: -1, max: 2 },
  'style.fontSizePx': { min: 12, max: 300 },
  'style.rotationDeg': { min: -180, max: 180 }
}

export const CLIP_TRANSFORM_PROPERTY_PATHS = Object.keys(CLIP_PROPERTIES)
export const TEXT_PROPERTY_PATHS = Object.keys(TEXT_PROPERTIES)

/** Đường dẫn tới cường độ của một effect. */
export function effectIntensityPath(effectId: string): string {
  return `effect.${effectId}.intensity`
}

/** Đường dẫn tới một thông số số của một effect. */
export function effectParamPath(effectId: string, paramKey: string): string {
  return `effect.${effectId}.params.${paramKey}`
}

/**
 * Tách một đường dẫn effect. Trả `null` khi không phải đường dẫn effect.
 *
 * Tra theo `effectId` chứ không theo chỉ số mảng, vì `clip/set-effects` thay CẢ
 * mảng: chỉ số đổi chỗ là keyframe lặng lẽ nhảy sang effect khác.
 */
export function parseEffectPath(path: string): { effectId: string; paramKey?: string } | null {
  const parts = path.split('.')
  if (parts[0] !== 'effect' || parts.length < 3) return null
  const effectId = parts[1]
  if (!effectId) return null
  if (parts.length === 3 && parts[2] === 'intensity') return { effectId }
  if (parts.length === 4 && parts[2] === 'params' && parts[3]) {
    return { effectId, paramKey: parts[3] }
  }
  return null
}

export interface ResolvedProperty {
  min: number
  max: number
  /** Giá trị đang lưu tĩnh, dùng làm nền khi đường keyframe rỗng. */
  staticValue: number
}

/**
 * Tra một đường dẫn trên một clip. `null` nghĩa là đường dẫn không hợp lệ cho
 * clip này — lệnh phải từ chối chứ không được lặng lẽ tạo một khoá rác.
 */
export function resolveClipProperty(clip: Clip, path: string): ResolvedProperty | null {
  const plain = CLIP_PROPERTIES[path]
  if (plain) {
    const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
    const key = path.slice('transform.'.length) as keyof typeof transform
    return { ...plain, staticValue: transform[key] }
  }

  const effectPath = parseEffectPath(path)
  if (!effectPath) return null
  const effect = clip.effects?.find((item) => item.id === effectPath.effectId)
  if (!effect) return null

  const definition = findClipEffect(effect.kind)

  if (effectPath.paramKey === undefined) {
    // Mặt nạ và tách nền không có thanh cường độ (`usesIntensity: false`), nên
    // cho đặt keyframe cường độ ở đó là bày ra một đường chuyển động không tác
    // động tới cái gì — cùng lý do giao diện không vẽ thanh trượt cho chúng.
    if (!definition?.usesIntensity) return null
    // Khớp `clampEffectIntensity` trong clip-effect-types.ts.
    return { min: 0, max: 1, staticValue: effect.intensity }
  }

  const spec = definition?.params.find((item) => item.key === effectPath.paramKey)
  // Chỉ thông số kiểu SỐ mới nội suy được. Màu và ô chọn không có "giá trị ở
  // giữa" nào có nghĩa, nên chúng đứng ngoài hệ này thay vì được đỡ nửa vời.
  if (!spec || spec.type !== 'number') return null
  const current = effect.params[spec.key]
  return {
    min: spec.min,
    max: spec.max,
    staticValue: typeof current === 'number' ? current : spec.default
  }
}

/** Tra một đường dẫn trên một khối chữ overlay. */
export function resolveTextProperty(overlay: TextOverlay, path: string): ResolvedProperty | null {
  const plain = TEXT_PROPERTIES[path]
  if (!plain) return null
  const style = overlay.style

  if (path === 'style.fontSizePx') return { ...plain, staticValue: style.fontSizePx }
  if (path === 'style.rotationDeg') return { ...plain, staticValue: style.rotationDeg ?? 0 }

  // Chữ chưa ghim vị trí thì `position` vắng mặt, và lấy 0 làm nền sẽ quăng chữ
  // lên góc trên-trái ngay lần đặt keyframe đầu tiên. Lấy giữa khung làm nền:
  // đó là chỗ `alignment` mặc định (5) đang đặt chữ, và là chỗ ít sai nhất cho
  // các alignment khác — lệnh đặt keyframe vị trí luôn kèm giá trị đo từ màn
  // hình, nên nền này chỉ là lưới an toàn.
  const position = style.position ?? { xPct: 0.5, yPct: 0.5 }
  return {
    ...plain,
    staticValue: path === 'style.position.xPct' ? position.xPct : position.yPct
  }
}
