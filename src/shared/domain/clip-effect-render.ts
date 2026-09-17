import { findClipEffect } from './clip-effect-catalog'
import * as color from './clip-effect-render-color'
import * as distort from './clip-effect-render-distort'
import * as region from './clip-effect-render-region'
import * as skin from './clip-effect-render-skin'
import * as stylize from './clip-effect-render-stylize'
import type { EffectOverlay, EffectRecipe, EffectRenderContext } from './clip-effect-render-types'
import { clampEffectIntensity, normalizeEffectParams, type ClipEffect } from './clip-effect-types'

/**
 * Ghép cả chồng effect của một clip thành những gì composition cần vẽ: MỘT bộ lọc
 * SVG (các primitive nối đuôi theo thứ tự chồng), danh sách mặt nạ, biến đổi và
 * lớp phủ.
 */

const RECIPES: Record<string, EffectRecipe> = {
  vignette: stylize.vignette,
  'film-grain': stylize.filmGrain,
  bloom: stylize.bloom,
  posterize: stylize.posterize,
  'light-leak': stylize.lightLeak,
  'retro-crt': stylize.retroCrt,
  'edge-glow': stylize.edgeGlow,
  'rgb-split': distort.rgbSplit,
  glitch: distort.glitch,
  mirror: distort.mirror,
  pixelate: distort.pixelate,
  handheld: distort.handheld,
  magnifier: distort.magnifier,
  'soft-blur': region.softBlur,
  'motion-blur': region.motionBlur,
  'tilt-shift': region.tiltShift,
  'rect-mask': region.rectMask,
  'circle-mask': region.circleMask,
  'local-mosaic': region.localMosaic,
  'luma-key': region.lumaKey,
  'chroma-key': region.chromaKey,
  duotone: color.duotone,
  sepia: color.sepia,
  invert: color.invert,
  levels: color.levels,
  hsl: color.hsl,
  'color-wheels': color.colorWheels,
  clarity: color.clarity,
  'shadows-highlights': color.shadowsHighlights,
  'skin-smooth': skin.skinSmooth
}

export function hasEffectRecipe(kind: string): boolean {
  return kind in RECIPES
}

/**
 * Chồng effect sạch cho kế hoạch dựng: bỏ kind lạ (dự án từ bản app mới hơn),
 * kẹp cường độ và thông số. Không còn effect nào thì trả `undefined`.
 */
export function resolveClipEffects(
  effects: readonly ClipEffect[] | undefined
): ClipEffect[] | undefined {
  const resolved = (effects ?? []).flatMap((effect) => {
    const definition = findClipEffect(effect.kind)
    if (!definition || !hasEffectRecipe(effect.kind)) return []
    return [
      {
        id: effect.id,
        kind: effect.kind,
        intensity: clampEffectIntensity(effect.intensity),
        params: normalizeEffectParams(definition, effect.params)
      }
    ]
  })
  return resolved.length ? resolved : undefined
}

export interface ClipEffectsRender {
  /** Id bộ lọc, đổi khi nội dung bộ lọc đổi; `undefined` nếu không effect nào cần bộ lọc. */
  filterId?: string
  /** Nội dung `<defs>`: bộ lọc và các `<clipPath>`. */
  defsSvg?: string
  /** Id `<clipPath>` cuối chuỗi (giao của mọi mặt nạ); `undefined` nếu không có mặt nạ. */
  clipPathId?: string
  transform?: string
  overlays: EffectOverlay[]
}

/** Chuỗi băm ngắn, ổn định (djb2) — để id bộ lọc đổi đúng khi nội dung đổi. */
function shortHash(text: string): string {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * Effect lạ (dự án từ bản app mới hơn) bị bỏ qua lặng lẽ, không làm hỏng clip.
 *
 * Id bộ lọc mang băm của nội dung: effect động (hạt phim, glitch) đổi bộ lọc mỗi
 * khung, và đổi luôn chuỗi `filter: url(#…)` thì trình duyệt chắc chắn vẽ lại —
 * không trông vào việc nó tự nhận ra `<filter>` cùng id vừa bị thay ruột.
 */
export function buildClipEffectsRender(
  clipKey: string,
  effects: readonly ClipEffect[] | undefined,
  context: EffectRenderContext
): ClipEffectsRender {
  const result: ClipEffectsRender = { overlays: [] }
  if (!effects?.length || context.width <= 0 || context.height <= 0) return result

  const primitives: string[] = []
  const base = `fx-${safeIdPart(clipKey)}`
  const transforms: string[] = []
  const clipShapes: string[] = []
  let input = 'SourceGraphic'

  effects.forEach((effect, index) => {
    const definition = findClipEffect(effect.kind)
    const recipe = RECIPES[effect.kind]
    if (!definition || !recipe) return
    const output = `fx${index}`
    const render = recipe(
      {
        intensity: definition.usesIntensity ? clampEffectIntensity(effect.intensity) : 1,
        params: normalizeEffectParams(definition, effect.params)
      },
      context,
      { input, output, prefix: `e${index}_` }
    )
    if (render.primitives) {
      primitives.push(render.primitives)
      input = output
    }
    if (render.clipShape) clipShapes.push(render.clipShape)
    if (render.transform) transforms.push(render.transform)
    if (render.overlays) result.overlays.push(...render.overlays)
  })

  if (transforms.length) result.transform = transforms.join(' ')
  const defs: string[] = []
  if (primitives.length) {
    const body = primitives.join('')
    result.filterId = `${base}-${shortHash(body)}`
    defs.push(
      `<filter id="${result.filterId}" color-interpolation-filters="sRGB" ` +
        `x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse">` +
        `${body}</filter>`
    )
  }
  if (clipShapes.length) {
    // Hình trong một `<clipPath>` là HỢP; muốn GIAO thì mỗi mặt nạ một `<clipPath>`
    // và cái sau tự bị cắt bởi cái trước (`clip-path` trên chính `<clipPath>`).
    const tag = shortHash(clipShapes.join(''))
    clipShapes.forEach((shape, index) => {
      const id = `${base}-c${index}-${tag}`
      const parent = index > 0 ? ` clip-path="url(#${base}-c${index - 1}-${tag})"` : ''
      defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"${parent}>${shape}</clipPath>`)
      result.clipPathId = id
    })
  }
  if (defs.length) result.defsSvg = defs.join('')
  return result
}
