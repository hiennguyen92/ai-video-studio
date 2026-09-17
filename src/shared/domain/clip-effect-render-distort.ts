import { n, num, pseudoRandom, str, type EffectRecipe } from './clip-effect-render-types'

/**
 * Công thức cho nhóm biến dạng: tách màu RGB, glitch, lật gương, khối điểm ảnh,
 * máy quay cầm tay, kính lúp.
 */

const RED_ONLY = '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'
const GREEN_ONLY = '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0'
const BLUE_ONLY = '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0'

/**
 * Tách ba kênh, dời đỏ sang trái và xanh dương sang phải rồi ghép lại bằng
 * `screen` — ba kênh rời nhau nên screen chính là cộng, không làm sáng thêm.
 */
export function rgbSplitPrimitives(
  input: string,
  output: string,
  prefix: string,
  dx: number
): string {
  return (
    `<feColorMatrix in="${input}" type="matrix" values="${RED_ONLY}" result="${prefix}r"/>` +
    `<feOffset in="${prefix}r" dx="${n(-dx)}" result="${prefix}ro"/>` +
    `<feColorMatrix in="${input}" type="matrix" values="${GREEN_ONLY}" result="${prefix}g"/>` +
    `<feColorMatrix in="${input}" type="matrix" values="${BLUE_ONLY}" result="${prefix}b"/>` +
    `<feOffset in="${prefix}b" dx="${n(dx)}" result="${prefix}bo"/>` +
    `<feBlend in="${prefix}ro" in2="${prefix}g" mode="screen" result="${prefix}rg"/>` +
    `<feBlend in="${prefix}bo" in2="${prefix}rg" mode="screen" result="${output}"/>`
  )
}

export const rgbSplit: EffectRecipe = ({ intensity }, { width }, io) => ({
  primitives: rgbSplitPrimitives(
    io.input,
    io.output,
    io.prefix,
    Math.max(1, intensity * width * 0.008)
  )
})

/** Số dải bị xô lệch trong một khung glitch. */
const GLITCH_BANDS = 5

/**
 * Dải ngang bị xô lệch + tách màu. Đổi mẫu mỗi 3 khung, và chỉ một phần các mẫu
 * giật mạnh — giật đều liên tục trông như rung chứ không như lỗi hình.
 *
 * Mỗi dải là một `feFlood` hình chữ nhật cắt lấy phần hình đã dời bằng `feOffset`,
 * rồi chồng lên hình gốc. KHÔNG dùng `feDisplacementMap`: đã đo trên preview,
 * displacement kéo cả chuỗi bộ lọc về CPU, chồng thêm vài blur là tụt từ 120 xuống
 * 6 khung/giây; flood + offset + composite thì chạy trên GPU.
 */
export const glitch: EffectRecipe = ({ intensity }, { frame, width, height }, io) => {
  const step = Math.floor(frame / 3)
  const roll = pseudoRandom(step)
  const strength = intensity * (roll > 0.6 ? 1 : 0.25)
  const p = io.prefix
  const bands: string[] = []
  const merge: string[] = [`<feMergeNode in="${io.input}"/>`]
  for (let index = 0; index < GLITCH_BANDS; index += 1) {
    const seed = step * 7 + index * 13
    const y = pseudoRandom(seed + 1) * height
    const bandHeight = height * (0.015 + 0.07 * pseudoRandom(seed + 2))
    const shift = (pseudoRandom(seed + 3) - 0.5) * 2 * strength * width * 0.06
    bands.push(
      `<feOffset in="${io.input}" dx="${n(shift)}" result="${p}o${index}"/>` +
        `<feFlood flood-color="#000" x="0" y="${n(y)}" width="${n(width)}" height="${n(bandHeight)}" result="${p}f${index}"/>` +
        `<feComposite in="${p}o${index}" in2="${p}f${index}" operator="in" result="${p}b${index}"/>`
    )
    merge.push(`<feMergeNode in="${p}b${index}"/>`)
  }
  const split = strength * width * 0.006 * (roll > 0.8 ? -1 : 1)
  return {
    primitives:
      bands.join('') +
      `<feMerge result="${p}d">${merge.join('')}</feMerge>` +
      rgbSplitPrimitives(`${p}d`, io.output, `${p}s`, Math.max(0.5, Math.abs(split)))
  }
}

export const mirror: EffectRecipe = ({ params }) => ({
  transform: str(params, 'axis', 'horizontal') === 'vertical' ? 'scale(1, -1)' : 'scale(-1, 1)'
})

/**
 * Khối điểm ảnh bằng bộ lọc SVG: lấy mẫu một điểm ở tâm mỗi ô (một chấm lát kín
 * cả khung), rồi nở mỗi chấm thành cả ô. Cạnh ô lẻ (2k+1) để nở bán kính k lát
 * vừa khít — cạnh chẵn thì các ô chồng hoặc hở nhau một đường 1px.
 */
export function pixelatePrimitives(
  input: string,
  output: string,
  prefix: string,
  blockPx: number
): string {
  const half = Math.max(1, Math.round((blockPx - 1) / 2))
  const block = half * 2 + 1
  return (
    `<feFlood x="${half}" y="${half}" width="1" height="1" flood-color="#000" result="${prefix}f"/>` +
    `<feComposite in="${prefix}f" in2="${prefix}f" operator="over" x="0" y="0" width="${block}" height="${block}" result="${prefix}t"/>` +
    `<feTile in="${prefix}t" result="${prefix}tt"/>` +
    `<feComposite in="${input}" in2="${prefix}tt" operator="in" result="${prefix}s"/>` +
    `<feMorphology in="${prefix}s" operator="dilate" radius="${half}" result="${output}"/>`
  )
}

export const pixelate: EffectRecipe = ({ intensity }, { width }, io) => ({
  primitives: pixelatePrimitives(io.input, io.output, io.prefix, 3 + intensity * width * 0.02)
})

/** Rung tay: tổng vài sóng sin lệch pha, phóng nhẹ để mép khung không lộ ra. */
export const handheld: EffectRecipe = ({ intensity }, { frame, fps, width }) => {
  const t = frame / Math.max(1, fps)
  const amplitude = intensity * width * 0.008
  const dx = (Math.sin(t * 1.3) * 0.6 + Math.sin(t * 2.9 + 1) * 0.4) * amplitude
  const dy = (Math.sin(t * 1.1 + 3) * 0.6 + Math.sin(t * 2.3 + 2) * 0.4) * amplitude
  const rotate = Math.sin(t * 0.9 + 2) * intensity * 0.6
  return {
    transform: `translate(${n(dx)}px, ${n(dy)}px) rotate(${n(rotate)}deg) scale(${n(1 + intensity * 0.04)})`
  }
}

/** Bán kính kính lúp (px) theo thông số % cạnh ngắn của hộp media. */
export function magnifierRadiusPx(
  params: Record<string, number | string>,
  width: number,
  height: number
): number {
  return Math.max(4, (num(params, 'radius', 18) / 100) * Math.min(width, height))
}

/**
 * Kính lúp bằng `feDisplacementMap`, bản đồ dịch chuyển dựng HOÀN TOÀN bằng
 * primitive.
 *
 * Không dùng `feImage` cho bản đồ: Chrome bỏ qua `feDisplacementMap` khi bản đồ đi
 * từ `feImage` (chặn đọc điểm ảnh), còn ảnh data URI thì tải bất đồng bộ nên bản
 * xuất chụp khung trước khi ảnh kịp tải.
 *
 * - Dải màu: nửa mặt phẳng đỏ bên trái tâm, làm mờ MỘT CHIỀU ngang với σ = R →
 *   kênh đỏ đi từ ~1 về ~0 qua tâm (hàm Φ, còn ~0.84 → 0.16 ở mép kính). Kênh xanh làm tương tự theo chiều dọc.
 *   Φ dốc nhất ở tâm và thoải dần ra mép, nên độ phóng đúng `zoom` ở tâm và nhẹ dần
 *   ra rìa — như thấu kính lồi thật.
 * - Hình tròn: đèn điểm cao R chiếu lên mặt phẳng phẳng cho N·L = R/√(r² + R²); lấy
 *   ngưỡng 1/√2 thì ra đúng hình tròn bán kính R.
 *
 * Độ dốc của Φ ở tâm là 1/(σ√2π) = 0.399/R, nên `scale` = R(1 − 1/zoom)/0.399.
 * σ = R giữ dải gần tuyến tính trong kính; σ nhỏ hơn thì Φ bão hoà sớm và hình
 * trong kính bị vuông lại. Nửa mặt phẳng rộng 6R để mép xa của nó không với tới kính.
 *
 * Làm mờ lấy mẫu ra ngoài khung (trong suốt) nên sát mép khung alpha tụt. Đặt lại
 * alpha = 1 ngay sau làm mờ: `feColorMatrix` chạy trên giá trị ĐÃ khử nhân alpha,
 * nên kết quả là tích chập chuẩn hoá — kính đặt sát mép vẫn đúng.
 */
export const magnifier: EffectRecipe = ({ params }, { width, height }, io) => {
  const radius = magnifierRadiusPx(params, width, height)
  const zoom = Math.max(1.01, num(params, 'zoom', 2))
  const cx = (num(params, 'x', 50) / 100) * width
  const cy = (num(params, 'y', 50) / 100) * height
  const sigma = radius
  const slope = 1 / (sigma * Math.sqrt(2 * Math.PI))
  const p = io.prefix
  const ring = n(radius)
  return {
    primitives:
      `<feFlood flood-color="#000" result="${p}k"/>` +
      `<feFlood flood-color="#f00" x="${n(cx - 6 * radius)}" y="0" width="${n(6 * radius)}" height="${n(height)}" result="${p}hr"/>` +
      `<feMerge result="${p}hm"><feMergeNode in="${p}k"/><feMergeNode in="${p}hr"/></feMerge>` +
      `<feGaussianBlur in="${p}hm" stdDeviation="${n(sigma)} 0" result="${p}rb"/>` +
      `<feColorMatrix in="${p}rb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1" result="${p}rx"/>` +
      `<feFlood flood-color="#0f0" x="0" y="${n(cy - 6 * radius)}" width="${n(width)}" height="${n(6 * radius)}" result="${p}vg"/>` +
      `<feMerge result="${p}vm"><feMergeNode in="${p}k"/><feMergeNode in="${p}vg"/></feMerge>` +
      `<feGaussianBlur in="${p}vm" stdDeviation="0 ${n(sigma)}" result="${p}gb"/>` +
      `<feColorMatrix in="${p}gb" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1" result="${p}gy"/>` +
      `<feComposite in="${p}rx" in2="${p}gy" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="${p}rg"/>` +
      `<feDiffuseLighting in="${io.input}" surfaceScale="0" diffuseConstant="1" lighting-color="#fff" result="${p}l">` +
      `<fePointLight x="${n(cx)}" y="${n(cy)}" z="${n(radius)}"/></feDiffuseLighting>` +
      `<feColorMatrix in="${p}l" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 60 0 0 0 ${n(-60 * Math.SQRT1_2)}" result="${p}c"/>` +
      `<feComposite in="${p}rg" in2="${p}c" operator="in" result="${p}i"/>` +
      `<feFlood flood-color="rgb(128,128,128)" result="${p}g"/>` +
      `<feMerge result="${p}m"><feMergeNode in="${p}g"/><feMergeNode in="${p}i"/></feMerge>` +
      `<feDisplacementMap in="${io.input}" in2="${p}m" scale="${n((radius * (1 - 1 / zoom)) / (slope * radius))}" xChannelSelector="R" yChannelSelector="G" result="${io.output}"/>`,
    overlays: [
      {
        background: `radial-gradient(circle at ${n((cx / width) * 100)}% ${n((cy / height) * 100)}%, rgba(255,255,255,0) calc(${ring}px - 3px), rgba(255,255,255,0.9) calc(${ring}px - 2px), rgba(255,255,255,0.9) ${ring}px, rgba(255,255,255,0) calc(${ring}px + 1px))`
      }
    ]
  }
}
