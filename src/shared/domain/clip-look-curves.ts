/**
 * Đường cong và ma trận màu dùng để dựng các look (LUT dựng sẵn).
 *
 * Mọi thứ là hàm thuần trên giá trị 0..1, lấy mẫu thành bảng cho
 * `feComponentTransfer type="table"` của bộ lọc SVG. Tách khỏi danh mục để danh
 * mục chỉ còn đọc như một bảng công thức màu.
 */

/** Số điểm lấy mẫu một đường cong. 33 điểm đủ mượt cho cả đường log dốc. */
const CURVE_SAMPLES = 33

export type Curve = (value: number) => number

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/** Lấy mẫu đường cong thành bảng giá trị, làm tròn cho chuỗi SVG ngắn gọn. */
export function sampleCurve(curve: Curve): number[] {
  return Array.from({ length: CURVE_SAMPLES }, (_, index) => {
    const value = clamp01(curve(index / (CURVE_SAMPLES - 1)))
    return Math.round(value * 10_000) / 10_000
  })
}

/** Nối nhiều đường cong: áp lần lượt từ trái sang phải. */
export function chain(...curves: Curve[]): Curve {
  return (value) => curves.reduce((current, curve) => curve(current), value)
}

/** Nâng đen / hạ trắng: đưa 0..1 về `black..white`. Nâng đen cho cảm giác phim bạc màu. */
export function levels(black: number, white = 1): Curve {
  return (value) => black + value * (white - black)
}

/** Gamma: < 1 sáng lên, > 1 tối đi, hai đầu giữ nguyên. */
export function gamma(power: number): Curve {
  return (value) => Math.pow(clamp01(value), power)
}

/**
 * Tăng tương phản hình chữ S quanh điểm giữa. `amount` 0 là giữ nguyên, 1 là rất
 * gắt. Dùng hàm lượng giác nên hai đầu 0 và 1 không bị bẻ gãy.
 */
export function sCurve(amount: number): Curve {
  return (value) => {
    const s = 0.5 - 0.5 * Math.cos(Math.PI * clamp01(value))
    return value + (s - value) * amount
  }
}

/** Nhân kênh, dùng để ấm/lạnh hoá từng kênh riêng. */
export function gain(multiplier: number): Curve {
  return (value) => value * multiplier
}

// ── Ma trận màu 5×4 cho `feColorMatrix type="matrix"` ─────────────────────────

/** Ma trận 3×3 tuyến tính mở rộng thành 5×4 (không cộng hằng, giữ alpha). */
export function matrix3(rows: [number[], number[], number[]]): number[] {
  return [...rows[0], 0, 0, ...rows[1], 0, 0, ...rows[2], 0, 0, 0, 0, 0, 1, 0]
}

/** Độ bão hoà theo hệ số Rec.709, cùng công thức `feColorMatrix type="saturate"`. */
export function saturation(amount: number): number[] {
  const r = 0.2126
  const g = 0.7152
  const b = 0.0722
  return matrix3([
    [r + (1 - r) * amount, g - g * amount, b - b * amount],
    [r - r * amount, g + (1 - g) * amount, b - b * amount],
    [r - r * amount, g - g * amount, b + (1 - b) * amount]
  ])
}

// ── Đường log của máy quay → tuyến tính, và tuyến tính → Rec.709 ─────────────

/** Sony S-Log3 → phản xạ tuyến tính, theo công thức Sony công bố. */
export const sLog3ToLinear: Curve = (value) => {
  const code = value * 1023
  return code >= 171.2102946929
    ? Math.pow(10, (code - 420) / 261.5) * (0.18 + 0.01) - 0.01
    : ((code - 95) * 0.01125) / (171.2102946929 - 95)
}

/** Canon Log 3 → tuyến tính, theo công thức Canon công bố. */
export const canonLog3ToLinear: Curve = (value) => {
  if (value < 0.097465473) {
    return -(Math.pow(10, (0.12783901 - value) / 0.36726845) - 1) / 14.98325
  }
  if (value <= 0.15277891) return (value - 0.12512219) / 1.9754798
  return (Math.pow(10, (value - 0.12240537) / 0.36726845) - 1) / 14.98325
}

/**
 * Tuyến tính → Rec.709 hiển thị, có nén vùng sáng.
 *
 * Log giữ được nhiều stop hơn màn hình hiện. Cắt thẳng ở 1 thì mây, bầu trời cháy
 * trắng mảng lớn; nén mềm phần trên 0,6 giữ lại chi tiết vùng sáng như LUT của hãng.
 */
export const linearToRec709: Curve = (value) => {
  const knee = 0.6
  const compressed =
    value <= knee ? value : knee + (1 - knee) * Math.tanh((value - knee) / (1 - knee))
  const linear = Math.max(0, compressed)
  return linear < 0.018 ? 4.5 * linear : 1.099 * Math.pow(linear, 0.45) - 0.099
}
