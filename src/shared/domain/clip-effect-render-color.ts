import {
  blendWithInput,
  channelTables,
  hexToUnitRgb,
  hueToUnitRgb,
  LUMA,
  n,
  num,
  str,
  type EffectRecipe
} from './clip-effect-render-types'

/**
 * Công thức cho nhóm màu: hai tông, nâu cổ, đảo màu, levels, HSL, bánh xe màu,
 * độ nét, vùng sáng/tối.
 */

const IDENTITY = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0]

/** Ma trận trộn tuyến tính giữa đơn vị và `target` theo `amount` — không cần primitive trộn thêm. */
function mixedMatrix(target: number[], amount: number): string {
  return IDENTITY.map((value, index) => n(value + (target[index] - value) * amount)).join(' ')
}

const SEPIA = [
  0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0
]
const INVERT = [-1, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, 0, -1, 0, 1, 0, 0, 0, 1, 0]
const GRAY = [...LUMA, 0, 0, ...LUMA, 0, 0, ...LUMA, 0, 0, 0, 0, 0, 1, 0].join(' ')

export const sepia: EffectRecipe = ({ intensity }, _context, io) => ({
  primitives: `<feColorMatrix in="${io.input}" type="matrix" values="${mixedMatrix(SEPIA, intensity)}" result="${io.output}"/>`
})

export const invert: EffectRecipe = ({ intensity }, _context, io) => ({
  primitives: `<feColorMatrix in="${io.input}" type="matrix" values="${mixedMatrix(INVERT, intensity)}" result="${io.output}"/>`
})

/** Ảnh xám rồi ánh xạ đen → màu tối, trắng → màu sáng. */
export const duotone: EffectRecipe = ({ intensity, params }, _context, io) => {
  const dark = hexToUnitRgb(str(params, 'shadowColor', '#1E2A78'))
  const light = hexToUnitRgb(str(params, 'highlightColor', '#F2B05E'))
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="matrix" values="${GRAY}" result="${io.prefix}g"/>` +
      channelTables(
        `${io.prefix}g`,
        `${io.prefix}d`,
        (value, channel) => dark[channel] + (light[channel] - dark[channel]) * value,
        2
      ) +
      blendWithInput(`${io.prefix}d`, io, intensity)
  }
}

export const levels: EffectRecipe = ({ params }, _context, io) => {
  const inBlack = num(params, 'inBlack', 0) / 100
  const inWhite = Math.max(inBlack + 0.01, num(params, 'inWhite', 100) / 100)
  const gamma = Math.max(0.05, num(params, 'gamma', 1))
  const outBlack = num(params, 'outBlack', 0) / 100
  const outWhite = num(params, 'outWhite', 100) / 100
  return {
    primitives: channelTables(io.input, io.output, (value) => {
      const normalized = Math.min(1, Math.max(0, (value - inBlack) / (inWhite - inBlack)))
      return outBlack + (outWhite - outBlack) * normalized ** (1 / gamma)
    })
  }
}

/** HSL toàn khung: xoay sắc độ, nhân bão hoà, kéo sáng về trắng hoặc đen. */
export const hsl: EffectRecipe = ({ params }, _context, io) => {
  const lightness = num(params, 'lightness', 0) / 100
  const slope = lightness >= 0 ? 1 - lightness : 1 + lightness
  const intercept = lightness >= 0 ? lightness : 0
  const func = (channel: string): string =>
    `<feFunc${channel} type="linear" slope="${n(slope)}" intercept="${n(intercept)}"/>`
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="hueRotate" values="${n(num(params, 'hue', 0))}" result="${io.prefix}h"/>` +
      `<feColorMatrix in="${io.prefix}h" type="saturate" values="${n(num(params, 'saturation', 100) / 100)}" result="${io.prefix}s"/>` +
      `<feComponentTransfer in="${io.prefix}s" result="${io.output}">${func('R')}${func('G')}${func('B')}</feComponentTransfer>`
  }
}

/**
 * Ám màu riêng cho vùng tối, trung tính, vùng sáng. Trọng số ba vùng cộng lại
 * bằng 1 ở mọi mức sáng, nên ba bánh xe cùng một màu thì ra ám đều cả hình.
 */
export const colorWheels: EffectRecipe = ({ params }, _context, io) => {
  const tint = (hueKey: string, amountKey: string): number[] => {
    const rgb = hueToUnitRgb(num(params, hueKey, 0))
    const mean = (rgb[0] + rgb[1] + rgb[2]) / 3
    const amount = (num(params, amountKey, 0) / 100) * 0.3
    return rgb.map((value) => (value - mean) * amount)
  }
  const shadow = tint('shadowHue', 'shadowAmount')
  const mid = tint('midHue', 'midAmount')
  const high = tint('highHue', 'highAmount')
  return {
    primitives: channelTables(io.input, io.output, (value, channel) => {
      const shadowWeight = (1 - value) ** 2
      const highWeight = value ** 2
      const midWeight = 1 - shadowWeight - highWeight
      return (
        value +
        shadowWeight * shadow[channel] +
        midWeight * mid[channel] +
        highWeight * high[channel]
      )
    })
  }
}

/** Unsharp mask: ảnh + k·(ảnh − ảnh mờ). */
export const clarity: EffectRecipe = ({ intensity, params }, { width }, io) => {
  const amount = intensity * 1.5
  const radius = num(params, 'radius', 3) * Math.max(0.25, width / 1920)
  return {
    primitives:
      `<feGaussianBlur in="${io.input}" stdDeviation="${n(radius)}" edgeMode="duplicate" result="${io.prefix}b"/>` +
      `<feComposite in="${io.input}" in2="${io.prefix}b" operator="arithmetic" k1="0" k2="${n(1 + amount)}" k3="${n(-amount)}" k4="0" result="${io.output}"/>`
  }
}

/**
 * Nâng vùng tối, hạ vùng sáng bằng hai "bướu" đường cong: bướu tối đỉnh ở 1/3,
 * bướu sáng đỉnh ở 2/3, cả hai về 0 ở đen tuyệt đối và trắng tuyệt đối — điểm
 * đen/trắng không đổi, không bị bệt.
 */
export const shadowsHighlights: EffectRecipe = ({ params }, _context, io) => {
  const shadows = num(params, 'shadows', 30) / 100
  const highlights = num(params, 'highlights', 30) / 100
  return {
    primitives: channelTables(io.input, io.output, (value) => {
      const shadowBump = (27 / 4) * value * (1 - value) ** 2
      const highBump = (27 / 4) * value ** 2 * (1 - value)
      return value + 0.25 * shadows * shadowBump - 0.25 * highlights * highBump
    })
  }
}
