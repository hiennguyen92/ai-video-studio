import { blendWithInput, n, str, type EffectRecipe } from './clip-effect-render-types'

/**
 * Công thức cho nhóm phong cách: tối góc, hạt phim, toả sáng, giảm mảng màu, lọt
 * sáng, TV cũ, viền phát sáng.
 */

export const vignette: EffectRecipe = ({ intensity }) => ({
  overlays: [
    {
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 40%, rgba(0,0,0,${n(0.9 * intensity)}) 100%)`
    }
  ]
})

/**
 * Hạt đổi theo khung (seed = khung hình) — hạt đứng yên trông như bụi dính ống
 * kính, không phải hạt phim. Nhiễu xám cộng quanh giá trị giữa nên không làm sáng
 * hay tối cả hình.
 */
export const filmGrain: EffectRecipe = ({ intensity }, { frame }, io) => {
  const amount = 0.45 * intensity
  return {
    primitives:
      `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="${(frame % 997) + 1}" result="${io.prefix}n"/>` +
      `<feColorMatrix in="${io.prefix}n" type="saturate" values="0" result="${io.prefix}g"/>` +
      `<feComposite in="${io.input}" in2="${io.prefix}g" operator="arithmetic" k1="0" k2="1" k3="${n(amount)}" k4="${n(-amount / 2)}" result="${io.output}"/>`
  }
}

/** Tách vùng sáng, làm mờ rồi cộng lại: sáng chói loang ra, vùng tối giữ nguyên. */
export const bloom: EffectRecipe = ({ intensity }, { width }, io) => ({
  primitives:
    `<feComponentTransfer in="${io.input}" result="${io.prefix}b">` +
    `<feFuncR type="linear" slope="2.5" intercept="-1.5"/>` +
    `<feFuncG type="linear" slope="2.5" intercept="-1.5"/>` +
    `<feFuncB type="linear" slope="2.5" intercept="-1.5"/>` +
    `</feComponentTransfer>` +
    `<feGaussianBlur in="${io.prefix}b" stdDeviation="${n(Math.max(1, width * 0.012))}" result="${io.prefix}s"/>` +
    `<feComposite in="${io.input}" in2="${io.prefix}s" operator="arithmetic" k1="0" k2="1" k3="${n(1.2 * intensity)}" k4="0" result="${io.output}"/>`
})

const POSTER_LEVELS = [0, 0.25, 0.5, 0.75, 1].join(' ')

export const posterize: EffectRecipe = ({ intensity }, _context, io) => ({
  primitives:
    `<feComponentTransfer in="${io.input}" result="${io.prefix}p">` +
    `<feFuncR type="discrete" tableValues="${POSTER_LEVELS}"/>` +
    `<feFuncG type="discrete" tableValues="${POSTER_LEVELS}"/>` +
    `<feFuncB type="discrete" tableValues="${POSTER_LEVELS}"/>` +
    `</feComponentTransfer>` +
    blendWithInput(`${io.prefix}p`, io, intensity)
})

/** Hai vệt sáng ấm trôi chậm qua khung, trộn kiểu screen nên chỉ làm sáng thêm. */
export const lightLeak: EffectRecipe = ({ intensity }, { frame, fps }) => {
  const t = frame / Math.max(1, fps)
  const x = 12 + 14 * Math.sin(t * 0.5)
  const y = 25 + 10 * Math.sin(t * 0.37 + 1)
  const x2 = 88 - 10 * Math.sin(t * 0.43 + 2)
  const a = n(0.85 * intensity)
  const b = n(0.5 * intensity)
  return {
    overlays: [
      {
        background:
          `radial-gradient(circle at ${n(x)}% ${n(y)}%, rgba(255,150,70,${a}) 0%, rgba(255,90,40,0) 55%), ` +
          `radial-gradient(circle at ${n(x2)}% 85%, rgba(255,70,120,${b}) 0%, rgba(255,70,120,0) 45%)`,
        mixBlendMode: 'screen'
      }
    ]
  }
}

/** Tách màu nhẹ trong bộ lọc + sọc quét và tối góc bằng lớp phủ. */
export const retroCrt: EffectRecipe = ({ intensity }, { height, width }, io) => {
  const shift = Math.max(1, Math.round(intensity * width * 0.002))
  const period = Math.max(2, Math.round(height / 270))
  const line = n(0.4 * intensity)
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${io.prefix}r"/>` +
      `<feOffset in="${io.prefix}r" dx="${-shift}" result="${io.prefix}ro"/>` +
      `<feColorMatrix in="${io.input}" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" result="${io.prefix}gb"/>` +
      `<feBlend in="${io.prefix}ro" in2="${io.prefix}gb" mode="screen" result="${io.prefix}m"/>` +
      `<feColorMatrix in="${io.prefix}m" type="saturate" values="${n(1 - 0.25 * intensity)}" result="${io.output}"/>`,
    overlays: [
      {
        background: `repeating-linear-gradient(0deg, rgba(0,0,0,${line}) 0px, rgba(0,0,0,${line}) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) ${period}px)`
      },
      {
        background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,${n(0.6 * intensity)}) 100%)`
      }
    ]
  }
}

/** Dò cạnh trên ảnh xám, tô màu, làm mờ nhẹ rồi cộng lên ảnh đã tối đi một chút. */
export const edgeGlow: EffectRecipe = ({ intensity, params }, { width }, io) => {
  const color = str(params, 'color', '#6FE3FF')
  const dim = n(1 - 0.45 * intensity)
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="saturate" values="0" result="${io.prefix}g"/>` +
      `<feConvolveMatrix in="${io.prefix}g" order="3" kernelMatrix="-1 -1 -1 -1 8 -1 -1 -1 -1" preserveAlpha="true" result="${io.prefix}e"/>` +
      `<feColorMatrix in="${io.prefix}e" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 4 0 0 0 0" result="${io.prefix}a"/>` +
      `<feFlood flood-color="${color}" result="${io.prefix}c"/>` +
      `<feComposite in="${io.prefix}c" in2="${io.prefix}a" operator="in" result="${io.prefix}k"/>` +
      `<feGaussianBlur in="${io.prefix}k" stdDeviation="${n(Math.max(0.8, width * 0.0015))}" result="${io.prefix}s"/>` +
      // Tối ảnh bằng ma trận (giữ alpha), không bằng hệ số k2 của phép cộng: k2 < 1
      // nhân cả alpha và làm cả khung trong suốt đi.
      `<feColorMatrix in="${io.input}" type="matrix" values="${dim} 0 0 0 0 0 ${dim} 0 0 0 0 0 ${dim} 0 0 0 0 0 1 0" result="${io.prefix}d"/>` +
      `<feComposite in="${io.prefix}d" in2="${io.prefix}s" operator="arithmetic" k1="0" k2="1" k3="${n(1.6 * intensity)}" k4="0" result="${io.output}"/>`
  }
}
