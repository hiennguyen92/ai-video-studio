import type { EffectParamValue } from './clip-effect-types'

/**
 * Hợp đồng chung của mọi "công thức vẽ" effect.
 *
 * Một công thức là hàm THUẦN theo khung hình: cùng effect, cùng khung, cùng kích
 * thước thì ra cùng một chuỗi. Nhờ vậy preview và bản xuất (dựng từng khung một,
 * có thể lệch thứ tự) cho ra đúng một hình.
 */

export interface EffectRenderContext {
  /** Khung hình tính từ đầu clip. */
  frame: number
  fps: number
  /** Kích thước (px CSS) của hộp media mà bộ lọc áp lên. */
  width: number
  height: number
}

/** Lớp phủ CSS đặt trên media, trong cùng khung bao (đi theo biến đổi của clip). */
export interface EffectOverlay {
  background: string
  mixBlendMode?: 'normal' | 'screen' | 'multiply' | 'overlay' | 'soft-light'
  opacity?: number
}

export interface EffectRender {
  /**
   * Chuỗi primitive SVG. Đọc từ `io.input`, kết quả cuối phải mang
   * `result="${io.output}"`. Kết quả trung gian đặt tên bằng `io.prefix`.
   */
  primitives?: string
  /**
   * Một hình SVG (`<rect>`, `<circle>`) toạ độ px trong hộp media. Nhiều mặt nạ
   * chồng thành GIAO của các hình.
   */
  clipShape?: string
  /** Biến đổi CSS nối thêm vào hộp media. */
  transform?: string
  overlays?: EffectOverlay[]
}

export interface EffectRecipeInput {
  intensity: number
  params: Record<string, EffectParamValue>
}

export interface PrimitiveIo {
  input: string
  output: string
  prefix: string
}

export type EffectRecipe = (
  effect: EffectRecipeInput,
  context: EffectRenderContext,
  io: PrimitiveIo
) => EffectRender

/** Số gọn cho thuộc tính SVG: 4 chữ số lẻ, không bao giờ in `NaN`. */
export function n(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 10_000) / 10_000)
}

export const num = (
  params: Record<string, EffectParamValue>,
  key: string,
  fallback = 0
): number => {
  const value = params[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const str = (
  params: Record<string, EffectParamValue>,
  key: string,
  fallback: string
): string => {
  const value = params[key]
  return typeof value === 'string' ? value : fallback
}

/** Số giả ngẫu nhiên 0..1 cố định theo khoá — không dùng `Math.random` để khung dựng lại y hệt. */
export function pseudoRandom(key: number): number {
  const value = Math.sin(key * 12.9898 + 78.233) * 43_758.5453
  return value - Math.floor(value)
}

/** Trộn tuyến tính kết quả với ảnh vào theo cường độ; cường độ 1 thì chỉ đổi tên. */
export function blendWithInput(effectResult: string, io: PrimitiveIo, amount: number): string {
  return (
    `<feComposite in="${effectResult}" in2="${io.input}" operator="arithmetic" ` +
    `k1="0" k2="${n(amount)}" k3="${n(1 - amount)}" k4="0" result="${io.output}"/>`
  )
}

/** Bảng tra từng kênh; `sample(v, channel)` với v 0..1, channel 0=R 1=G 2=B. */
export function channelTables(
  input: string,
  output: string,
  sample: (value: number, channel: number) => number,
  size = 33
): string {
  const table = (channel: number): string =>
    Array.from({ length: size }, (_, index) =>
      n(Math.min(1, Math.max(0, sample(index / (size - 1), channel))))
    ).join(' ')
  return (
    `<feComponentTransfer in="${input}" result="${output}">` +
    `<feFuncR type="table" tableValues="${table(0)}"/>` +
    `<feFuncG type="table" tableValues="${table(1)}"/>` +
    `<feFuncB type="table" tableValues="${table(2)}"/>` +
    `</feComponentTransfer>`
  )
}

/** `#RRGGBB` → [r, g, b] 0..1. Chuỗi hỏng trả đen. */
export function hexToUnitRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) return [0, 0, 0]
  const value = parseInt(match[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

/** Sắc độ (độ) → màu bão hoà đầy đủ, sáng 50%, dạng 0..1. */
export function hueToUnitRgb(hueDeg: number): [number, number, number] {
  const h = (((hueDeg % 360) + 360) % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const table: Array<[number, number, number]> = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x]
  ]
  return table[Math.min(5, Math.floor(h))]
}

/** Hệ số độ sáng Rec.709. */
export const LUMA = [0.2126, 0.7152, 0.0722] as const
