import { describe, expect, it } from 'vitest'
import { clipAppliedTags } from './clip-applied-tags'
import type { Clip } from './timeline-track-types'

const base: Clip = {
  id: 'c',
  assetId: 'a',
  startUs: 0,
  durationUs: 1_000_000,
  sourceInUs: 0,
  speed: 1,
  volume: 1,
  fadeInUs: 0,
  fadeOutUs: 0
}
const effect = (kind: string, id: string): NonNullable<Clip['effects']>[number] => ({
  id,
  kind,
  intensity: 1,
  params: {}
})

describe('nhãn đang áp trên clip', () => {
  it('clip trơn không có nhãn', () => {
    expect(clipAppliedTags(base)).toEqual([])
  })

  it('LUT, zoom rồi effect theo thứ tự chồng; effect trùng loại gộp kèm số lần', () => {
    const clip: Clip = {
      ...base,
      look: { id: 'mono-film', intensity: 1 },
      motion: { kind: 'zoom-in', intensity: 0.5 },
      effects: [
        effect('vignette', '1'),
        effect('film-grain', '2'),
        effect('vignette', '3'),
        effect('vignette', '4')
      ]
    }
    expect(clipAppliedTags(clip)).toEqual([
      { category: 'lut', key: 'mono-film', count: 1 },
      { category: 'zoom', key: 'zoom-in', count: 1 },
      { category: 'effect', key: 'vignette', count: 3 },
      { category: 'effect', key: 'film-grain', count: 1 }
    ])
  })

  it('gom effect: nhiều loại thành "Effect ×tổng", một loại vẫn giữ tên', () => {
    const many: Clip = {
      ...base,
      look: { id: 'mono-film', intensity: 1 },
      effects: [effect('vignette', '1'), effect('film-grain', '2'), effect('vignette', '3')]
    }
    expect(clipAppliedTags(many, { collapseEffects: true })).toEqual([
      { category: 'lut', key: 'mono-film', count: 1 },
      { category: 'effect', key: '*', count: 3 }
    ])
    const oneKind: Clip = { ...base, effects: [effect('vignette', '1'), effect('vignette', '2')] }
    expect(clipAppliedTags(oneKind, { collapseEffects: true })).toEqual([
      { category: 'effect', key: 'vignette', count: 2 }
    ])
  })
})
