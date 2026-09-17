import { describe, expect, it } from 'vitest'
import { CLIP_EFFECTS, findClipEffect } from './clip-effect-catalog'
import { buildClipEffectsRender, hasEffectRecipe } from './clip-effect-render'
import { pixelatePrimitives } from './clip-effect-render-distort'
import { defaultEffectParams, normalizeEffectParams, type ClipEffect } from './clip-effect-types'

const CONTEXT = { frame: 12, fps: 30, width: 1920, height: 1080 }

function effectOf(kind: string, overrides: Partial<ClipEffect> = {}): ClipEffect {
  const definition = findClipEffect(kind)
  if (!definition) throw new Error(`thiếu effect ${kind}`)
  return {
    id: `id-${kind}`,
    kind,
    intensity: 0.7,
    params: defaultEffectParams(definition),
    ...overrides
  }
}

/**
 * Kiểm tra chuỗi bộ lọc tự đóng/mở thẻ đúng cặp và mọi `in`/`in2` trỏ tới một
 * kết quả đã có TRƯỚC đó. Trỏ sai tên thì trình duyệt không báo lỗi — nó lặng lẽ
 * dùng kết quả liền trước, và effect ra sai mà không ai biết.
 */
function assertWellFormedFilter(svg: string): void {
  const stack: string[] = []
  const results = new Set(['SourceGraphic', 'SourceAlpha'])
  for (const match of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, attributes, selfClosing] = match
    if (closing) {
      expect(stack.pop()).toBe(name)
      continue
    }
    for (const ref of attributes.matchAll(/\bin2?="([^"]+)"/g)) expect(results).toContain(ref[1])
    const result = /\bresult="([^"]+)"/.exec(attributes)
    if (result) results.add(result[1])
    if (!selfClosing) stack.push(name)
  }
  expect(stack).toEqual([])
  expect(svg).not.toMatch(/NaN|undefined|Infinity/)
}

describe('danh mục effect', () => {
  it('29 effect, kind duy nhất, kind nào cũng có công thức vẽ', () => {
    expect(CLIP_EFFECTS).toHaveLength(29)
    const kinds = CLIP_EFFECTS.map((effect) => effect.kind)
    expect(new Set(kinds).size).toBe(kinds.length)
    for (const kind of kinds) expect(hasEffectRecipe(kind)).toBe(true)
  })

  it('thông số mặc định nằm trong khoảng và khoá thông số không trùng', () => {
    for (const definition of CLIP_EFFECTS) {
      const keys = definition.params.map((param) => param.key)
      expect(new Set(keys).size).toBe(keys.length)
      const defaults = defaultEffectParams(definition)
      expect(normalizeEffectParams(definition, defaults)).toEqual(defaults)
    }
  })

  it('kẹp số ngoài khoảng, bỏ khoá lạ, màu và lựa chọn sai về mặc định', () => {
    const duotone = findClipEffect('duotone')!
    expect(
      normalizeEffectParams(duotone, { shadowColor: 'red', highlightColor: '#abcdef', junk: 3 })
    ).toEqual({
      shadowColor: '#1E2A78',
      highlightColor: '#ABCDEF'
    })
    const magnifier = findClipEffect('magnifier')!
    expect(normalizeEffectParams(magnifier, { zoom: 99, radius: Number.NaN }).zoom).toBe(4)
    expect(normalizeEffectParams(magnifier, { radius: Number.NaN }).radius).toBe(18)
    const mirror = findClipEffect('mirror')!
    expect(normalizeEffectParams(mirror, { axis: 'diagonal' }).axis).toBe('horizontal')
  })
})

describe('dựng chồng effect', () => {
  it('mọi effect đơn lẻ, ở mọi cường độ, cho ra bộ lọc hợp lệ', () => {
    for (const definition of CLIP_EFFECTS) {
      for (const intensity of [0, 0.5, 1]) {
        const render = buildClipEffectsRender(
          'clip-1',
          [effectOf(definition.kind, { intensity })],
          CONTEXT
        )
        if (render.defsSvg) assertWellFormedFilter(render.defsSvg)
        if (render.filterId) expect(render.defsSvg).toContain('result="fx0"')
        const produced = Boolean(
          render.defsSvg || render.clipPathId || render.transform || render.overlays.length
        )
        expect(produced, definition.kind).toBe(true)
      }
    }
  })

  it('chồng cả 29 effect nối đuôi nhau đúng thứ tự', () => {
    const effects = CLIP_EFFECTS.map((definition) => effectOf(definition.kind))
    const render = buildClipEffectsRender('clip-1', effects, CONTEXT)
    assertWellFormedFilter(render.defsSvg!)
    expect(render.defsSvg!.match(/<clipPath /g)).toHaveLength(2)
    // Mặt nạ thứ hai bị cắt bởi mặt nạ thứ nhất: giao, không phải hợp.
    expect(render.defsSvg).toMatch(
      /<clipPath id="fx-clip-1-c1-\w+" clipPathUnits="userSpaceOnUse" clip-path="url\(#fx-clip-1-c0-\w+\)">/
    )
    expect(render.clipPathId).toMatch(/-c1-/)
    expect(render.transform).toMatch(/scale\(-1, 1\).*translate/)
  })

  it('bỏ qua kind lạ, không có effect thì không có bộ lọc', () => {
    expect(
      buildClipEffectsRender('c', [effectOf('sepia', { kind: 'future-effect' })], CONTEXT)
    ).toEqual({
      overlays: []
    })
    expect(buildClipEffectsRender('c', undefined, CONTEXT).filterId).toBeUndefined()
  })

  it('id bộ lọc an toàn cho `url(#…)` và đổi theo khung khi effect động', () => {
    const grain = [effectOf('film-grain')]
    const first = buildClipEffectsRender('clip:1/a', grain, CONTEXT)
    const next = buildClipEffectsRender('clip:1/a', grain, { ...CONTEXT, frame: 13 })
    expect(first.filterId).toMatch(/^fx-clip_1_a-[a-z0-9]+$/)
    expect(next.filterId).not.toBe(first.filterId)
    // Effect tĩnh: id đứng yên, trình duyệt không phải dựng lại bộ lọc mỗi khung.
    const sepia = [effectOf('sepia')]
    expect(buildClipEffectsRender('c', sepia, CONTEXT).filterId).toBe(
      buildClipEffectsRender('c', sepia, { ...CONTEXT, frame: 99 }).filterId
    )
  })

  it('cường độ bị bỏ qua với effect không dùng cường độ', () => {
    const a = buildClipEffectsRender('c', [effectOf('levels', { intensity: 0 })], CONTEXT)
    const b = buildClipEffectsRender('c', [effectOf('levels', { intensity: 1 })], CONTEXT)
    expect(a.defsSvg).toBe(b.defsSvg)
  })
})

describe('công thức riêng', () => {
  it('khối điểm ảnh luôn lẻ cạnh để nở vừa khít', () => {
    const svg = pixelatePrimitives('in', 'out', 'p', 10)
    const radius = Number(/radius="(\d+)"/.exec(svg)![1])
    const block = Number(/width="(\d+)" height="\d+" result="pt"/.exec(svg)![1])
    expect(block).toBe(radius * 2 + 1)
  })

  it('kính lúp: scale = R(1 − 1/zoom)/0.399, không dùng feImage', () => {
    const effect = effectOf('magnifier', { params: { x: 50, y: 50, radius: 20, zoom: 2 } })
    const render = buildClipEffectsRender('c', [effect], CONTEXT)
    // R = 20% cạnh ngắn 1080 = 216px.
    expect(render.defsSvg).toContain('scale="270.7159"')
    expect(render.defsSvg).toContain('<fePointLight x="960" y="540" z="216"/>')
    // Chrome bỏ qua feDisplacementMap khi bản đồ đi từ feImage.
    expect(render.defsSvg).not.toContain('feImage')
  })

  it('mặt nạ chữ nhật đổi tâm/cỡ phần trăm thành hộp px', () => {
    const effect = effectOf('rect-mask', {
      params: { x: 30, y: 50, width: 40, height: 20, radius: 0 }
    })
    expect(buildClipEffectsRender('c', [effect], CONTEXT).defsSvg).toContain(
      '<rect x="192" y="432" width="768" height="216" rx="0"/>'
    )
  })

  it('vùng sáng/tối giữ nguyên điểm đen và điểm trắng', () => {
    const effect = effectOf('shadows-highlights', { params: { shadows: 100, highlights: 100 } })
    const table = /tableValues="([^"]+)"/.exec(
      buildClipEffectsRender('c', [effect], CONTEXT).defsSvg!
    )![1]
    const values = table.split(' ').map(Number)
    expect(values[0]).toBe(0)
    expect(values.at(-1)).toBe(1)
    expect(values[11]).toBeGreaterThan(11 / 32)
  })
})
