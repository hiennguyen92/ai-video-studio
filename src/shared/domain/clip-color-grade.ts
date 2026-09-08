/**
 * Chỉnh màu cho một clip.
 *
 * Phạm vi cố ý HẸP: sáng, tương phản, độ bão hoà, ám màu ấm/lạnh, và tối góc.
 * Năm thứ này diễn tả được bằng bộ lọc CSS và một lớp phủ, nên chúng chạy y hệt
 * ở preview lẫn lúc xuất mà không cần thêm một đường vẽ thứ hai.
 *
 * **Không có LUT (.cube).** Bộ lọc CSS không áp được bảng tra ba chiều; làm đúng
 * phải đẩy từng khung qua một shader WebGL, tức là thêm một đường vẽ riêng và một
 * cái giá về tốc độ render chưa đo. Thà thiếu còn hơn bày ra một ô "LUT" chỉ chỉnh
 * gần đúng bằng mấy bộ lọc chắp vá.
 */

export interface ClipColorGrade {
  /** 0,5–1,5. 1 là giữ nguyên. */
  brightness: number
  contrast: number
  saturation: number
  /** -1 (lạnh) tới 1 (ấm). 0 là giữ nguyên. */
  temperature: number
  /** 0–1. Tối dần bốn góc. */
  vignette: number
}

export const NEUTRAL_COLOR_GRADE: ClipColorGrade = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  vignette: 0
}

const EPSILON = 0.001

export function isNeutralColorGrade(grade: ClipColorGrade | undefined): boolean {
  if (!grade) return true

  return (
    Math.abs(grade.brightness - 1) < EPSILON &&
    Math.abs(grade.contrast - 1) < EPSILON &&
    Math.abs(grade.saturation - 1) < EPSILON &&
    Math.abs(grade.temperature) < EPSILON &&
    grade.vignette < EPSILON
  )
}

/**
 * Chuỗi `filter` của CSS. Trả về `undefined` khi không có gì để chỉnh.
 *
 * Trả `undefined` chứ không trả `"brightness(1) contrast(1)"`: đặt `filter` lên
 * một phần tử buộc trình duyệt tách lớp hợp thành riêng, tốn thêm bộ nhớ và thời
 * gian vẽ cho MỌI clip dù không chỉnh gì.
 */
export function colorGradeFilterCss(grade: ClipColorGrade | undefined): string | undefined {
  if (!grade) return undefined

  const parts: string[] = []
  if (Math.abs(grade.brightness - 1) >= EPSILON) parts.push(`brightness(${grade.brightness})`)
  if (Math.abs(grade.contrast - 1) >= EPSILON) parts.push(`contrast(${grade.contrast})`)
  if (Math.abs(grade.saturation - 1) >= EPSILON) parts.push(`saturate(${grade.saturation})`)

  return parts.length > 0 ? parts.join(' ') : undefined
}

export interface ColorOverlay {
  color: string
  opacity: number
  /** Chế độ hoà trộn — `soft-light` giữ được chi tiết vùng sáng và vùng tối. */
  blendMode: 'soft-light'
}

/**
 * Lớp phủ ám màu ấm hoặc lạnh.
 *
 * Làm bằng lớp phủ chứ không bằng `sepia()` hay `hue-rotate()`: hai bộ lọc đó
 * xoay TOÀN BỘ dải màu nên da người ngả sang xanh lá hoặc tím rất nhanh. Một lớp
 * cam hoặc xanh hoà kiểu soft-light chỉ đẩy nhiệt độ, giữ nguyên tương quan màu.
 */
export function temperatureOverlay(grade: ClipColorGrade | undefined): ColorOverlay | undefined {
  if (!grade || Math.abs(grade.temperature) < EPSILON) return undefined

  return {
    color: grade.temperature > 0 ? '#ff8a2b' : '#2b8aff',
    opacity: Math.min(1, Math.abs(grade.temperature)) * 0.45,
    blendMode: 'soft-light'
  }
}

/** Nền chuyển sắc cho lớp tối góc. Trả `undefined` khi tắt. */
export function vignetteBackgroundCss(grade: ClipColorGrade | undefined): string | undefined {
  if (!grade || grade.vignette < EPSILON) return undefined

  // Bắt đầu tối từ 45% bán kính: bắt đầu sớm hơn thì tối cả vào giữa khung, mất
  // hẳn tác dụng dẫn mắt vào chủ thể.
  const strength = Math.min(1, grade.vignette) * 0.85
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength.toFixed(3)}) 100%)`
}

/** Kẹp mọi giá trị về khoảng hợp lệ. Dùng khi nạp dữ liệu cũ hoặc dữ liệu lạ. */
export function clampColorGrade(grade: Partial<ClipColorGrade>): ClipColorGrade {
  const clamp = (value: number | undefined, min: number, max: number, fallback: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, value))
  }

  return {
    brightness: clamp(grade.brightness, 0.5, 1.5, 1),
    contrast: clamp(grade.contrast, 0.5, 1.5, 1),
    saturation: clamp(grade.saturation, 0, 2, 1),
    temperature: clamp(grade.temperature, -1, 1, 0),
    vignette: clamp(grade.vignette, 0, 1, 0)
  }
}
