/**
 * Effect hình chồng lên clip (tab Effects trong Library).
 *
 * Một clip mang một MẢNG effect, áp theo đúng thứ tự trong mảng. Mỗi effect lưu
 * `kind` (khoá bền trong danh mục), cường độ và thông số riêng — không lưu công
 * thức vẽ, để sửa công thức về sau thì dự án cũ đi theo.
 */

export type EffectParamValue = number | string

export interface ClipEffect {
  /** Id riêng của lần áp này: một clip có thể chồng hai effect cùng loại. */
  id: string
  kind: string
  /** 0..1. Effect không dùng cường độ (mặt nạ, tách nền) thì bỏ qua giá trị này. */
  intensity: number
  params: Record<string, EffectParamValue>
}

interface ParamBase {
  key: string
  labelVi: string
  labelEn: string
}

export type EffectParamSpec =
  | (ParamBase & {
      type: 'number'
      min: number
      max: number
      step: number
      default: number
      unit?: string
    })
  | (ParamBase & { type: 'color'; default: string })
  | (ParamBase & {
      type: 'select'
      default: string
      options: Array<{ value: string; labelVi: string; labelEn: string }>
    })

export type EffectGroup = 'stylize' | 'blur' | 'distort' | 'color' | 'key' | 'mask'

export interface EffectDefinition {
  kind: string
  nameVi: string
  nameEn: string
  group: EffectGroup
  /** Có thanh cường độ không. Mặt nạ và tách nền thì không — chỉ có thông số. */
  usesIntensity: boolean
  params: EffectParamSpec[]
  /** Từ khoá cho agent chọn. */
  tags: string[]
}

/** Thông số mặc định của một effect. */
export function defaultEffectParams(
  definition: EffectDefinition
): Record<string, EffectParamValue> {
  return Object.fromEntries(definition.params.map((param) => [param.key, param.default]))
}

/**
 * Kẹp thông số về khoảng hợp lệ, điền mặc định cho chỗ thiếu, bỏ khoá lạ.
 *
 * Chạy ở tầng dựng kế hoạch: dự án sửa tay hay agent gửi số ngoài khoảng không được
 * làm hỏng bộ lọc (một `NaN` lọt vào SVG là cả clip biến mất không báo lỗi).
 */
export function normalizeEffectParams(
  definition: EffectDefinition,
  params: Record<string, EffectParamValue> | undefined
): Record<string, EffectParamValue> {
  const result: Record<string, EffectParamValue> = {}
  for (const spec of definition.params) {
    const raw = params?.[spec.key]
    if (spec.type === 'number') {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.default
      result[spec.key] = Math.min(spec.max, Math.max(spec.min, value))
    } else if (spec.type === 'color') {
      result[spec.key] =
        typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : spec.default
    } else {
      result[spec.key] =
        typeof raw === 'string' && spec.options.some((option) => option.value === raw)
          ? raw
          : spec.default
    }
  }
  return result
}

export function clampEffectIntensity(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(1, Math.max(0, value))
}
