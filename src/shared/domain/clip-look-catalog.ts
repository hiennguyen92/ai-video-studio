import {
  canonLog3ToLinear,
  chain,
  gain,
  gamma,
  levels,
  linearToRec709,
  matrix3,
  sCurve,
  sLog3ToLinear,
  sampleCurve,
  saturation
} from './clip-look-curves'

/**
 * Danh mục look màu dựng sẵn (tab LUT).
 *
 * Mỗi look là một chuỗi bước màu vẽ bằng bộ lọc SVG — đường cong từng kênh, ma
 * trận màu, hạt nhiễu — nằm ngay trong composition, nên preview và bản xuất cho
 * ra cùng một màu. Không đọc file `.cube`: LUT 3D tuỳ ý không dựng đúng bằng bộ
 * lọc SVG, và bộ này đủ cho các look phổ biến.
 *
 * Tên trung tính, không dùng tên hay nhãn hiệu của hãng phim/máy ảnh. Hai look
 * chuyển log giữ tên chuẩn màu ("S-Log3 → 709") vì đó là tên kỹ thuật.
 */

export type LookStage =
  | { type: 'curve'; r: number[]; g: number[]; b: number[] }
  | { type: 'matrix'; values: number[] }
  | { type: 'grain'; amount: number }

export interface LookDefinition {
  /** Khoá bền: dự án lưu id này, không lưu công thức. */
  id: string
  nameVi: string
  nameEn: string
  /** `log` là LUT chuyển màu máy quay; `creative` là look tạo phong cách. */
  category: 'log' | 'creative'
  stages: LookStage[]
  /** Từ khoá cho agent chọn. */
  tags: string[]
}

/** Cùng một đường cong cho cả ba kênh. */
function curveAll(curve: (value: number) => number): LookStage {
  const table = sampleCurve(curve)
  return { type: 'curve', r: table, g: table, b: table }
}

/** Ba đường cong riêng cho ba kênh. */
function curveRgb(
  r: (value: number) => number,
  g: (value: number) => number,
  b: (value: number) => number
): LookStage {
  return { type: 'curve', r: sampleCurve(r), g: sampleCurve(g), b: sampleCurve(b) }
}

const matrix = (values: number[]): LookStage => ({ type: 'matrix', values })

export const CLIP_LOOKS: LookDefinition[] = [
  {
    id: 'slog3-to-709',
    nameVi: 'S-Log3 → 709',
    nameEn: 'S-Log3 → 709',
    category: 'log',
    stages: [
      curveAll(sLog3ToLinear),
      // S-Gamut3.Cine → Rec.709, tuyến tính. Hàng cộng bằng 1 để xám giữ xám.
      matrix(
        matrix3([
          [1.6269, -0.5401, -0.0868],
          [-0.1785, 1.4179, -0.2394],
          [-0.0444, -0.1961, 1.2405]
        ])
      ),
      curveAll(linearToRec709)
    ],
    tags: ['log', 's-log3', 'máy quay', 'chuyển màu', 'rec709']
  },
  {
    id: 'canon-log3-to-709',
    nameVi: 'Canon Log 3 → 709',
    nameEn: 'Canon Log 3 → 709',
    category: 'log',
    stages: [
      curveAll(canonLog3ToLinear),
      // Cinema Gamut → Rec.709 xấp xỉ, tuyến tính. Hàng cộng bằng 1 để xám giữ xám.
      matrix(
        matrix3([
          [1.72, -0.55, -0.17],
          [-0.15, 1.31, -0.16],
          [-0.05, -0.28, 1.33]
        ])
      ),
      curveAll(linearToRec709)
    ],
    tags: ['log', 'canon log 3', 'máy quay', 'chuyển màu', 'rec709']
  },
  {
    id: 'chrome-classic',
    nameVi: 'Chrome cổ điển',
    nameEn: 'Classic chrome',
    category: 'creative',
    stages: [
      matrix(saturation(0.72)),
      curveRgb(
        chain(levels(0.03), sCurve(0.25)),
        chain(levels(0.03), sCurve(0.2)),
        chain(levels(0.06, 0.95), sCurve(0.2))
      )
    ],
    tags: ['trầm', 'phóng sự', 'nhạt màu', 'documentary']
  },
  {
    id: 'soft-portrait',
    nameVi: 'Chân dung mềm',
    nameEn: 'Soft portrait',
    category: 'creative',
    stages: [
      matrix(saturation(0.85)),
      curveRgb(
        chain(levels(0.04), gamma(0.94), gain(1.02)),
        chain(levels(0.04), gamma(0.96)),
        chain(levels(0.05, 0.96), gamma(0.98))
      )
    ],
    tags: ['chân dung', 'da', 'mềm', 'portrait']
  },
  {
    id: 'vivid-landscape',
    nameVi: 'Phong cảnh rực',
    nameEn: 'Vivid landscape',
    category: 'creative',
    stages: [matrix(saturation(1.45)), curveAll(sCurve(0.45))],
    tags: ['phong cảnh', 'rực rỡ', 'du lịch', 'landscape']
  },
  {
    id: 'street-contrast',
    nameVi: 'Phố tương phản',
    nameEn: 'Street contrast',
    category: 'creative',
    stages: [
      matrix(saturation(0.8)),
      curveRgb(sCurve(0.6), sCurve(0.6), chain(sCurve(0.6), gain(1.04)))
    ],
    tags: ['đường phố', 'gắt', 'tương phản', 'street']
  },
  {
    id: 'warm-film',
    nameVi: 'Phim vàng ấm',
    nameEn: 'Warm film',
    category: 'creative',
    stages: [
      matrix(saturation(1.1)),
      curveRgb(
        chain(levels(0.05), gain(1.06), sCurve(0.2)),
        chain(levels(0.04), gain(1.02), sCurve(0.2)),
        chain(levels(0.03, 0.88), sCurve(0.15))
      )
    ],
    tags: ['phim', 'ấm', 'hoài niệm', 'film']
  },
  {
    id: 'instant-faded',
    nameVi: 'Máy ảnh dùng một lần',
    nameEn: 'Instant faded',
    category: 'creative',
    stages: [
      matrix(saturation(0.8)),
      curveRgb(
        chain(levels(0.1, 0.94), gamma(0.92)),
        chain(levels(0.12, 0.96), gamma(0.9)),
        chain(levels(0.1, 0.9), gamma(0.96))
      ),
      { type: 'grain', amount: 0.16 }
    ],
    tags: ['bạc màu', 'hạt', 'lomo', 'instant', 'hoài niệm']
  },
  {
    id: 'night-tungsten',
    nameVi: 'Phim đêm',
    nameEn: 'Night film',
    category: 'creative',
    stages: [
      matrix(saturation(1.1)),
      curveRgb(
        chain(sCurve(0.35), gain(0.98)),
        chain(sCurve(0.35), gain(1.01)),
        chain(levels(0.04), sCurve(0.3), gain(1.06))
      )
    ],
    tags: ['đêm', 'thành phố', 'lạnh', 'night', 'neon']
  },
  {
    id: 'teal-orange',
    nameVi: 'Xanh két – cam',
    nameEn: 'Teal & orange',
    category: 'creative',
    stages: [
      // Đẩy vùng tối về xanh két, vùng sáng về cam: kênh đỏ cong lên ở vùng sáng,
      // kênh lam nâng ở vùng tối và hạ ở vùng sáng.
      curveRgb(
        chain(gamma(1.08), sCurve(0.3), gain(1.05)),
        chain(levels(0.02), sCurve(0.2)),
        chain(levels(0.08, 0.86), gamma(0.95))
      ),
      matrix(saturation(1.15))
    ],
    tags: ['điện ảnh', 'cinematic', 'teal', 'orange', 'hollywood']
  },
  {
    id: 'mono-film',
    nameVi: 'Phim đen trắng',
    nameEn: 'Mono film',
    category: 'creative',
    stages: [
      matrix(saturation(0)),
      curveAll(chain(levels(0.03), sCurve(0.45))),
      { type: 'grain', amount: 0.12 }
    ],
    tags: ['đen trắng', 'monochrome', 'b&w', 'hạt', 'cổ điển']
  },
  {
    id: 'warm-vintage',
    nameVi: 'Cổ điển ấm',
    nameEn: 'Warm vintage',
    category: 'creative',
    stages: [
      matrix(saturation(0.78)),
      curveRgb(
        chain(levels(0.08), gain(1.06)),
        chain(levels(0.06, 0.96)),
        chain(levels(0.04, 0.82))
      )
    ],
    tags: ['vintage', 'ấm', 'hoài niệm', 'retro']
  },
  {
    id: 'cool-blue',
    nameVi: 'Lạnh xanh',
    nameEn: 'Cool blue',
    category: 'creative',
    stages: [
      curveRgb(
        chain(gain(0.92), sCurve(0.2)),
        chain(gain(0.98), sCurve(0.2)),
        chain(levels(0.04), gain(1.1), sCurve(0.15))
      )
    ],
    tags: ['lạnh', 'xanh', 'mùa đông', 'cool']
  },
  {
    id: 'golden-hour',
    nameVi: 'Hoàng hôn vàng',
    nameEn: 'Golden hour',
    category: 'creative',
    stages: [
      matrix(saturation(1.12)),
      curveRgb(chain(gain(1.1), gamma(0.94)), chain(gain(1.02)), chain(gain(0.82), gamma(1.05)))
    ],
    tags: ['hoàng hôn', 'vàng', 'ấm', 'sunset', 'golden']
  },
  {
    id: 'cyber-neon',
    nameVi: 'Neon tím',
    nameEn: 'Cyber neon',
    category: 'creative',
    stages: [
      matrix(saturation(1.3)),
      curveRgb(
        chain(gain(1.08), sCurve(0.3)),
        chain(gain(0.86), sCurve(0.3)),
        chain(levels(0.06), gain(1.18), sCurve(0.25))
      )
    ],
    tags: ['neon', 'tím', 'cyberpunk', 'đêm']
  },
  {
    id: 'silver-bleach',
    nameVi: 'Bạc phai',
    nameEn: 'Silver bleach',
    category: 'creative',
    stages: [matrix(saturation(0.45)), curveAll(sCurve(0.7))],
    tags: ['bạc', 'gắt', 'nhạt màu', 'bleach', 'chiến tranh']
  }
]

/** Tra look theo id. Id lạ (dự án từ bản app khác) trả `undefined`, không ném. */
export function findClipLook(id: string): LookDefinition | undefined {
  return CLIP_LOOKS.find((look) => look.id === id)
}
