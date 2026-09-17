import {
  centerX,
  centerY,
  colorParam,
  numberParam,
  selectParam
} from './clip-effect-param-builders'
import type { EffectDefinition } from './clip-effect-types'

/**
 * Danh mục effect hình (tab Effects). Chỉ mô tả: tên, nhóm, thông số, từ khoá.
 * Công thức vẽ nằm ở `clip-effect-render-*`, tra theo `kind`.
 *
 * Tên tự đặt, trung tính; danh sách tham khảo các trình dựng phổ biến nhưng không
 * chép mã hay hình của ai.
 */

const intensityOnly = (
  kind: string,
  nameVi: string,
  nameEn: string,
  group: EffectDefinition['group'],
  tags: string[],
  params: EffectDefinition['params'] = []
): EffectDefinition => ({ kind, nameVi, nameEn, group, usesIntensity: true, params, tags })

export const CLIP_EFFECTS: EffectDefinition[] = [
  // ── Mặt nạ, vùng ───────────────────────────────────────────────────────────
  {
    kind: 'rect-mask',
    nameVi: 'Mặt nạ chữ nhật',
    nameEn: 'Rectangle mask',
    group: 'mask',
    usesIntensity: false,
    params: [
      centerX(),
      centerY(),
      numberParam('width', 'Rộng', 'Width', 5, 100, 60, 1, '%'),
      numberParam('height', 'Cao', 'Height', 5, 100, 60, 1, '%'),
      numberParam('radius', 'Bo góc', 'Corner radius', 0, 50, 4, 1, '%')
    ],
    tags: ['mặt nạ', 'cắt khung', 'mask', 'crop']
  },
  {
    kind: 'circle-mask',
    nameVi: 'Mặt nạ tròn',
    nameEn: 'Circle mask',
    group: 'mask',
    usesIntensity: false,
    params: [centerX(), centerY(), numberParam('radius', 'Bán kính', 'Radius', 5, 100, 35, 1, '%')],
    tags: ['mặt nạ', 'tròn', 'mask', 'spotlight']
  },
  {
    kind: 'local-mosaic',
    nameVi: 'Che mờ vùng',
    nameEn: 'Local mosaic',
    group: 'mask',
    usesIntensity: true,
    params: [
      centerX(),
      centerY(),
      numberParam('width', 'Rộng', 'Width', 5, 100, 30, 1, '%'),
      numberParam('height', 'Cao', 'Height', 5, 100, 30, 1, '%')
    ],
    tags: ['che', 'mosaic', 'khuôn mặt', 'biển số', 'censor']
  },
  {
    kind: 'magnifier',
    nameVi: 'Kính lúp',
    nameEn: 'Magnifier',
    group: 'distort',
    usesIntensity: false,
    params: [
      centerX(),
      centerY(),
      numberParam('radius', 'Bán kính', 'Radius', 5, 50, 18, 1, '%'),
      numberParam('zoom', 'Độ phóng', 'Zoom', 1.2, 4, 2, 0.1, '×')
    ],
    tags: ['phóng to', 'kính lúp', 'zoom', 'nhấn mạnh chi tiết']
  },
  {
    kind: 'tilt-shift',
    nameVi: 'Tilt-shift',
    nameEn: 'Tilt-shift',
    group: 'blur',
    usesIntensity: true,
    params: [centerY(), numberParam('band', 'Dải nét', 'Sharp band', 5, 80, 30, 1, '%')],
    tags: ['mô hình thu nhỏ', 'miniature', 'mờ trên dưới', 'tilt-shift']
  },

  // ── Tách nền ───────────────────────────────────────────────────────────────
  {
    kind: 'luma-key',
    nameVi: 'Tách nền theo độ sáng',
    nameEn: 'Luma key',
    group: 'key',
    usesIntensity: false,
    params: [
      numberParam('threshold', 'Ngưỡng', 'Threshold', 0, 100, 20, 1, '%'),
      numberParam('softness', 'Độ mềm', 'Softness', 1, 50, 10, 1, '%'),
      selectParam(
        'remove',
        'Xoá vùng',
        'Remove',
        [
          ['dark', 'Tối', 'Dark'],
          ['light', 'Sáng', 'Light']
        ],
        'dark'
      )
    ],
    tags: ['tách nền', 'key', 'nền đen', 'nền trắng']
  },
  {
    kind: 'chroma-key',
    nameVi: 'Tách nền xanh',
    nameEn: 'Chroma key',
    group: 'key',
    usesIntensity: false,
    params: [
      selectParam(
        'keyColor',
        'Màu nền',
        'Key colour',
        [
          ['green', 'Xanh lá', 'Green'],
          ['blue', 'Xanh dương', 'Blue']
        ],
        'green'
      ),
      numberParam('tolerance', 'Dung sai', 'Tolerance', 0, 60, 15, 1, '%'),
      numberParam('softness', 'Độ mềm', 'Softness', 1, 50, 12, 1, '%')
    ],
    tags: ['phông xanh', 'green screen', 'tách nền', 'chroma key']
  },

  // ── Chỉnh màu ──────────────────────────────────────────────────────────────
  {
    kind: 'levels',
    nameVi: 'Levels',
    nameEn: 'Levels',
    group: 'color',
    usesIntensity: false,
    params: [
      numberParam('inBlack', 'Đen vào', 'Input black', 0, 90, 0, 1, '%'),
      numberParam('inWhite', 'Trắng vào', 'Input white', 10, 100, 100, 1, '%'),
      numberParam('gamma', 'Gamma', 'Gamma', 0.3, 3, 1, 0.05),
      numberParam('outBlack', 'Đen ra', 'Output black', 0, 90, 0, 1, '%'),
      numberParam('outWhite', 'Trắng ra', 'Output white', 10, 100, 100, 1, '%')
    ],
    tags: ['levels', 'tương phản', 'điểm đen', 'điểm trắng']
  },
  {
    kind: 'hsl',
    nameVi: 'HSL',
    nameEn: 'HSL',
    group: 'color',
    usesIntensity: false,
    params: [
      numberParam('hue', 'Xoay sắc độ', 'Hue shift', -180, 180, 0, 1, '°'),
      numberParam('saturation', 'Bão hoà', 'Saturation', 0, 200, 100, 1, '%'),
      numberParam('lightness', 'Độ sáng', 'Lightness', -50, 50, 0, 1, '%')
    ],
    tags: ['hsl', 'sắc độ', 'bão hoà', 'đổi màu']
  },
  {
    kind: 'color-wheels',
    nameVi: 'Bánh xe màu 3 vùng',
    nameEn: 'Colour wheels',
    group: 'color',
    usesIntensity: false,
    params: [
      numberParam('shadowHue', 'Vùng tối: sắc độ', 'Shadows hue', 0, 360, 200, 1, '°'),
      numberParam('shadowAmount', 'Vùng tối: mức', 'Shadows amount', 0, 100, 0, 1, '%'),
      numberParam('midHue', 'Trung tính: sắc độ', 'Midtones hue', 0, 360, 40, 1, '°'),
      numberParam('midAmount', 'Trung tính: mức', 'Midtones amount', 0, 100, 0, 1, '%'),
      numberParam('highHue', 'Vùng sáng: sắc độ', 'Highlights hue', 0, 360, 45, 1, '°'),
      numberParam('highAmount', 'Vùng sáng: mức', 'Highlights amount', 0, 100, 0, 1, '%')
    ],
    tags: ['bánh xe màu', 'lift gamma gain', 'color wheels', 'ám màu']
  },
  {
    kind: 'clarity',
    nameVi: 'Độ nét',
    nameEn: 'Clarity',
    group: 'color',
    usesIntensity: true,
    params: [numberParam('radius', 'Bán kính', 'Radius', 1, 10, 3, 1)],
    tags: ['sắc nét', 'clarity', 'chi tiết', 'tương phản cục bộ']
  },
  {
    kind: 'shadows-highlights',
    nameVi: 'Vùng sáng/tối',
    nameEn: 'Shadows & highlights',
    group: 'color',
    usesIntensity: false,
    params: [
      numberParam('shadows', 'Nâng vùng tối', 'Shadows', -100, 100, 30, 1, '%'),
      numberParam('highlights', 'Hạ vùng sáng', 'Highlights', -100, 100, 30, 1, '%')
    ],
    tags: ['vùng tối', 'vùng sáng', 'shadows', 'highlights', 'cứu sáng']
  },

  // ── Phong cách ─────────────────────────────────────────────────────────────
  intensityOnly('vignette', 'Tối góc', 'Vignette', 'stylize', ['tối góc', 'vignette', 'điện ảnh']),
  intensityOnly('film-grain', 'Hạt phim', 'Film grain', 'stylize', [
    'hạt',
    'phim',
    'grain',
    'cổ điển'
  ]),
  intensityOnly('rgb-split', 'Tách màu RGB', 'RGB split', 'distort', [
    'tách màu',
    'quang sai',
    'rgb split',
    'chromatic'
  ]),
  intensityOnly('glitch', 'Nhiễu kỹ thuật số', 'Glitch', 'distort', [
    'glitch',
    'nhiễu',
    'lỗi hình',
    'cyberpunk'
  ]),
  intensityOnly('bloom', 'Toả sáng', 'Bloom', 'stylize', ['toả sáng', 'glow', 'bloom', 'mơ màng']),
  intensityOnly('posterize', 'Giảm mảng màu', 'Posterize', 'stylize', [
    'poster',
    'mảng màu',
    'hoạt hình'
  ]),
  intensityOnly(
    'duotone',
    'Hai tông màu',
    'Duotone',
    'color',
    ['hai màu', 'duotone', 'poster'],
    [
      colorParam('shadowColor', 'Màu vùng tối', 'Shadow colour', '#1E2A78'),
      colorParam('highlightColor', 'Màu vùng sáng', 'Highlight colour', '#F2B05E')
    ]
  ),
  {
    kind: 'mirror',
    nameVi: 'Lật gương',
    nameEn: 'Mirror',
    group: 'distort',
    usesIntensity: false,
    params: [
      selectParam(
        'axis',
        'Chiều lật',
        'Axis',
        [
          ['horizontal', 'Ngang', 'Horizontal'],
          ['vertical', 'Dọc', 'Vertical']
        ],
        'horizontal'
      )
    ],
    tags: ['lật', 'gương', 'mirror', 'flip']
  },
  intensityOnly('soft-blur', 'Làm mờ mềm', 'Soft blur', 'blur', ['mờ', 'blur', 'nền mờ']),
  intensityOnly(
    'motion-blur',
    'Mờ chuyển động',
    'Motion blur',
    'blur',
    ['mờ chuyển động', 'tốc độ', 'motion blur'],
    [
      selectParam(
        'direction',
        'Hướng',
        'Direction',
        [
          ['horizontal', 'Ngang', 'Horizontal'],
          ['vertical', 'Dọc', 'Vertical']
        ],
        'horizontal'
      )
    ]
  ),
  intensityOnly('light-leak', 'Lọt sáng', 'Light leak', 'stylize', [
    'lọt sáng',
    'light leak',
    'ấm',
    'hoài niệm'
  ]),
  intensityOnly('sepia', 'Nâu cổ', 'Sepia', 'color', ['nâu', 'sepia', 'cổ điển', 'hoài niệm']),
  intensityOnly('invert', 'Đảo màu', 'Invert', 'color', ['đảo màu', 'âm bản', 'invert']),
  intensityOnly('retro-crt', 'TV cũ', 'Retro CRT', 'stylize', [
    'tv cũ',
    'crt',
    'retro',
    'sọc quét'
  ]),
  intensityOnly('pixelate', 'Khối điểm ảnh', 'Pixelate', 'distort', [
    'pixel',
    'khối',
    '8-bit',
    'che'
  ]),
  intensityOnly(
    'edge-glow',
    'Viền phát sáng',
    'Edge glow',
    'stylize',
    ['viền sáng', 'neon', 'edge'],
    [colorParam('color', 'Màu viền', 'Glow colour', '#6FE3FF')]
  ),
  intensityOnly('handheld', 'Máy quay cầm tay', 'Handheld camera', 'distort', [
    'rung tay',
    'cầm tay',
    'handheld',
    'phim tài liệu'
  ])
]

/** Tra effect theo `kind`. Kind lạ (dự án từ bản app khác) trả `undefined`, không ném. */
export function findClipEffect(kind: string): EffectDefinition | undefined {
  return CLIP_EFFECTS.find((effect) => effect.kind === kind)
}
