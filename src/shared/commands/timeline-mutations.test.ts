import { describe, expect, it } from 'vitest'
import type { Clip } from '../domain/timeline-track-types'
import { carveOutRange, splitClipAt, trimClipEdgeTo } from './timeline-mutations'

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function clip(id: string, startUs: number, durationUs: number, sourceInUs = 0): Clip {
  return {
    id,
    assetId: 'asset_1',
    startUs,
    durationUs,
    sourceInUs,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0
  }
}

describe('carveOutRange — chính sách ghi đè', () => {
  it('bỏ clip bị đè hoàn toàn', () => {
    const result = carveOutRange([clip('a', 1000, 1000)], 0, 5000, { makeId })
    expect(result).toHaveLength(0)
  })

  it('cắt đuôi clip chớm mép trái', () => {
    const [only] = carveOutRange([clip('a', 0, 5000)], 3000, 9000, { makeId })
    expect(only.startUs).toBe(0)
    expect(only.durationUs).toBe(3000)
  })

  it('cắt đầu clip chớm mép phải và dời sourceIn tương ứng', () => {
    const [only] = carveOutRange([clip('a', 2000, 5000, 500)], 0, 4000, { makeId })
    expect(only.startUs).toBe(4000)
    expect(only.durationUs).toBe(3000)
    // Mất 2000µs ở đầu nên điểm vào nguồn phải tiến thêm 2000µs.
    expect(only.sourceInUs).toBe(2500)
  })

  it('tách đôi khi khoảng đè nằm gọn bên trong clip', () => {
    const parts = carveOutRange([clip('a', 0, 10_000)], 3000, 6000, { makeId })
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ startUs: 0, durationUs: 3000, sourceInUs: 0 })
    expect(parts[1]).toMatchObject({ startUs: 6000, durationUs: 4000, sourceInUs: 6000 })
    expect(parts[1].id).not.toBe('a')
  })

  it('bỏ qua clip được đánh dấu giữ lại', () => {
    const result = carveOutRange([clip('a', 0, 5000)], 0, 5000, { keepClipId: 'a', makeId })
    expect(result).toHaveLength(1)
  })

  it('không đụng tới clip không giao nhau', () => {
    const result = carveOutRange([clip('a', 0, 1000), clip('b', 8000, 1000)], 2000, 5000, {
      makeId
    })
    expect(result.map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('trimClipEdgeTo', () => {
  const limits = { assetDurationUs: 10_000, minDurationUs: 1000 }

  it('kéo mép cuối và kẹp theo phần nguồn còn lại', () => {
    const trimmed = trimClipEdgeTo(clip('a', 0, 3000, 2000), 'end', 50_000, limits)
    // Nguồn còn 10_000 - 2_000 = 8_000µs kể từ điểm vào.
    expect(trimmed?.durationUs).toBe(8000)
  })

  it('không cho mép đầu lùi quá điểm bắt đầu vật liệu', () => {
    const trimmed = trimClipEdgeTo(clip('a', 5000, 3000, 1000), 'start', 0, limits)
    // Chỉ còn 1000µs vật liệu phía trước nên sớm nhất là 4000µs.
    expect(trimmed?.startUs).toBe(4000)
    expect(trimmed?.sourceInUs).toBe(0)
  })

  it('giữ thời lượng tối thiểu', () => {
    const trimmed = trimClipEdgeTo(clip('a', 0, 3000), 'start', 9999, limits)
    expect(trimmed?.durationUs).toBe(1000)
  })
})

describe('splitClipAt', () => {
  it('tách và dời sourceIn của nửa sau', () => {
    const halves = splitClipAt(clip('a', 1000, 4000, 500), 3000, 'b')
    expect(halves).not.toBeNull()
    const [head, tail] = halves!
    expect(head).toMatchObject({ startUs: 1000, durationUs: 2000, sourceInUs: 500 })
    expect(tail).toMatchObject({ id: 'b', startUs: 3000, durationUs: 2000, sourceInUs: 2500 })
  })

  it('từ chối điểm cắt nằm ngoài clip', () => {
    expect(splitClipAt(clip('a', 1000, 4000), 1000, 'b')).toBeNull()
    expect(splitClipAt(clip('a', 1000, 4000), 5000, 'b')).toBeNull()
    expect(splitClipAt(clip('a', 1000, 4000), 9000, 'b')).toBeNull()
  })

  it('chia fade về đúng mảnh chứa nó', () => {
    const source = { ...clip('a', 0, 4000), fadeInUs: 500, fadeOutUs: 800 }
    const [head, tail] = splitClipAt(source, 2000, 'b')!
    expect(head).toMatchObject({ fadeInUs: 500, fadeOutUs: 0 })
    expect(tail).toMatchObject({ fadeInUs: 0, fadeOutUs: 800 })
  })
})
