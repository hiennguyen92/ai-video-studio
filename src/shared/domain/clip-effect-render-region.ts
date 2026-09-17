import { pixelatePrimitives } from './clip-effect-render-distort'
import { LUMA, n, num, str, type EffectRecipe } from './clip-effect-render-types'

/**
 * Công thức cho làm mờ, mặt nạ và tách nền — những effect tác động theo VÙNG của
 * khung hình.
 */

export const softBlur: EffectRecipe = ({ intensity }, { width }, io) => ({
  primitives: `<feGaussianBlur in="${io.input}" stdDeviation="${n(intensity * width * 0.01)}" edgeMode="duplicate" result="${io.output}"/>`
})

export const motionBlur: EffectRecipe = ({ intensity, params }, { width }, io) => {
  const amount = n(intensity * width * 0.015)
  const deviation =
    str(params, 'direction', 'horizontal') === 'vertical' ? `0 ${amount}` : `${amount} 0`
  return {
    primitives: `<feGaussianBlur in="${io.input}" stdDeviation="${deviation}" edgeMode="duplicate" result="${io.output}"/>`
  }
}

/**
 * Mờ trên và dưới, giữ nét một dải ngang. Mặt nạ dựng bằng hai `feFlood` rồi làm
 * mờ cho mép mềm — không cần ảnh nhúng. Làm mờ kéo alpha sát mép khung xuống còn
 * một nửa, nên nhân đôi alpha sau đó để mép ngoài vẫn mờ hẳn.
 */
export const tiltShift: EffectRecipe = ({ intensity, params }, { width, height }, io) => {
  const center = (num(params, 'y', 50) / 100) * height
  const band = (num(params, 'band', 30) / 100) * height
  const top = Math.max(0, center - band / 2)
  const bottom = Math.min(height, center + band / 2)
  return {
    primitives:
      `<feGaussianBlur in="${io.input}" stdDeviation="${n(Math.max(0.5, intensity * width * 0.006))}" edgeMode="duplicate" result="${io.prefix}b"/>` +
      `<feFlood flood-color="#000" x="0" y="0" width="${n(width)}" height="${n(top)}" result="${io.prefix}t"/>` +
      `<feFlood flood-color="#000" x="0" y="${n(bottom)}" width="${n(width)}" height="${n(Math.max(0, height - bottom))}" result="${io.prefix}u"/>` +
      `<feMerge result="${io.prefix}m"><feMergeNode in="${io.prefix}t"/><feMergeNode in="${io.prefix}u"/></feMerge>` +
      `<feGaussianBlur in="${io.prefix}m" stdDeviation="${n(height * 0.06)}" result="${io.prefix}ms"/>` +
      `<feComponentTransfer in="${io.prefix}ms" result="${io.prefix}ma"><feFuncA type="linear" slope="2"/></feComponentTransfer>` +
      `<feComposite in="${io.prefix}b" in2="${io.prefix}ma" operator="in" result="${io.prefix}c"/>` +
      `<feMerge result="${io.output}"><feMergeNode in="${io.input}"/><feMergeNode in="${io.prefix}c"/></feMerge>`
  }
}

/** Hình chữ nhật theo tâm/cỡ phần trăm → hộp px trong hộp media. */
function rectBoxPx(
  params: Record<string, number | string>,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const boxWidth = (num(params, 'width', 60) / 100) * width
  const boxHeight = (num(params, 'height', 60) / 100) * height
  return {
    x: (num(params, 'x', 50) / 100) * width - boxWidth / 2,
    y: (num(params, 'y', 50) / 100) * height - boxHeight / 2,
    width: boxWidth,
    height: boxHeight
  }
}

export const rectMask: EffectRecipe = ({ params }, { width, height }) => {
  const box = rectBoxPx(params, width, height)
  const radius = (num(params, 'radius', 4) / 100) * Math.min(width, height)
  return {
    clipShape: `<rect x="${n(box.x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" rx="${n(radius)}"/>`
  }
}

export const circleMask: EffectRecipe = ({ params }, { width, height }) => ({
  clipShape: `<circle cx="${n((num(params, 'x', 50) / 100) * width)}" cy="${n((num(params, 'y', 50) / 100) * height)}" r="${n((num(params, 'radius', 35) / 100) * Math.min(width, height))}"/>`
})

/** Khối điểm ảnh chỉ trong một ô chữ nhật: che mặt, biển số. */
export const localMosaic: EffectRecipe = ({ intensity, params }, { width, height }, io) => {
  const { x, y, width: w, height: h } = rectBoxPx(params, width, height)
  return {
    primitives:
      pixelatePrimitives(
        io.input,
        `${io.prefix}p`,
        `${io.prefix}x`,
        5 + intensity * width * 0.025
      ) +
      `<feFlood flood-color="#000" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" result="${io.prefix}r"/>` +
      `<feComposite in="${io.prefix}p" in2="${io.prefix}r" operator="in" result="${io.prefix}c"/>` +
      `<feMerge result="${io.output}"><feMergeNode in="${io.input}"/><feMergeNode in="${io.prefix}c"/></feMerge>`
  }
}

/**
 * Tách nền theo độ sáng: alpha dốc tuyến tính quanh ngưỡng. Nhân với alpha sẵn có
 * (hàng cuối của ma trận chỉ đọc màu) rồi giao với ảnh vào để không làm hiện lại
 * phần đã trong suốt.
 */
export const lumaKey: EffectRecipe = ({ params }, _context, io) => {
  const threshold = num(params, 'threshold', 20) / 100
  const slope = 1 / Math.max(0.01, num(params, 'softness', 10) / 100)
  const removeLight = str(params, 'remove', 'dark') === 'light'
  const sign = removeLight ? -1 : 1
  const offset = removeLight ? slope * (1 - threshold) : -slope * threshold
  const row = LUMA.map((weight) => n(sign * slope * weight)).join(' ')
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ${row} 0 ${n(offset)}" result="${io.prefix}a"/>` +
      `<feComposite in="${io.prefix}a" in2="${io.input}" operator="in" result="${io.output}"/>`
  }
}

/**
 * Tách phông xanh: độ "trội" của kênh khoá so với trung bình hai kênh kia. Trội
 * dưới dung sai thì giữ nguyên, vượt thì alpha giảm dần trong khoảng độ mềm. Không
 * khử ám xanh: ma trận tuyến tính không làm được `min()`, kéo kênh xanh xuống đều
 * tay thì đổi màu cả vùng giữ lại.
 */
export const chromaKey: EffectRecipe = ({ params }, _context, io) => {
  const tolerance = num(params, 'tolerance', 15) / 100
  const slope = 1 / Math.max(0.01, num(params, 'softness', 12) / 100)
  const blue = str(params, 'keyColor', 'green') === 'blue'
  // Hệ số cho (R, G, B) của "độ trội": +1 ở kênh khoá, −0.5 ở hai kênh còn lại.
  const dominance = blue ? [-0.5, -0.5, 1] : [-0.5, 1, -0.5]
  const alphaRow = dominance.map((weight) => n(-slope * weight)).join(' ')
  return {
    primitives:
      `<feColorMatrix in="${io.input}" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 ${alphaRow} 0 ${n(1 + slope * tolerance)}" result="${io.prefix}a"/>` +
      `<feComposite in="${io.prefix}a" in2="${io.input}" operator="in" result="${io.output}"/>`
  }
}
