import { describe, expect, it } from 'vitest'
import type { Clip } from '../domain/timeline-track-types'
import {
  rateStretchClip,
  rippleTrimTrackClips,
  slipClip,
  slipSourceInForDrag
} from './timeline-edit-tools'

const clip = (
  id: string,
  startUs: number,
  durationUs: number,
  extra: Partial<Clip> = {}
): Clip => ({
  id,
  assetId: 'a',
  startUs,
  durationUs,
  sourceInUs: 2_000_000,
  speed: 1,
  volume: 1,
  fadeInUs: 0,
  fadeOutUs: 0,
  ...extra
})
const limits = { assetDurationUs: 20_000_000, minDurationUs: 1000 }

describe('slip', () => {
  it('đổi điểm vào nguồn, giữ vị trí và độ dài; kẹp trong vật liệu nguồn', () => {
    const c = clip('a', 1_000_000, 3_000_000)
    expect(slipClip(c, 5_000_000, 20_000_000)).toMatchObject({
      startUs: 1_000_000,
      durationUs: 3_000_000,
      sourceInUs: 5_000_000
    })
    expect(slipClip(c, -9, 20_000_000).sourceInUs).toBe(0)
    expect(slipClip(c, 19_000_000, 20_000_000).sourceInUs).toBe(17_000_000)
  })

  it('ảnh tĩnh không slip; kéo sang phải thì phát đoạn nguồn sớm hơn, theo tốc độ', () => {
    const c = clip('a', 0, 3_000_000, { speed: 2 })
    expect(slipClip(c, 9_000_000, undefined)).toBe(c)
    expect(slipSourceInForDrag(c, 500_000)).toBe(1_000_000)
  })
})

describe('ripple trim', () => {
  const track = [
    clip('a', 0, 3_000_000),
    clip('b', 3_000_000, 2_000_000),
    clip('c', 6_000_000, 1_000_000)
  ]

  it('cắt ngắn mép cuối kéo mọi clip phía sau lùi lên, giữ khoảng trống giữa chúng', () => {
    const next = rippleTrimTrackClips(track, 'a', 'end', 2_000_000, limits)!
    expect(next.map((item) => [item.id, item.startUs, item.durationUs])).toEqual([
      ['a', 0, 2_000_000],
      ['b', 2_000_000, 2_000_000],
      ['c', 5_000_000, 1_000_000]
    ])
  })

  it('mép đầu: clip giữ chỗ bắt đầu, nguồn đầu bị cắt, phía sau dịch theo', () => {
    const next = rippleTrimTrackClips(track, 'b', 'start', 3_500_000, limits)!
    const b = next.find((item) => item.id === 'b')!
    expect(b).toMatchObject({ startUs: 3_000_000, durationUs: 1_500_000, sourceInUs: 2_500_000 })
    expect(next.find((item) => item.id === 'c')!.startUs).toBe(5_500_000)
    expect(next.find((item) => item.id === 'a')!.startUs).toBe(0)
  })

  it('kéo dài mép cuối đẩy clip sau ra, không đè', () => {
    const next = rippleTrimTrackClips(track, 'a', 'end', 4_000_000, limits)!
    expect(next.find((item) => item.id === 'b')!.startUs).toBe(4_000_000)
  })
})

describe('rate stretch', () => {
  it('kéo mép cuối dài gấp đôi thì chậm một nửa, đoạn nguồn giữ nguyên', () => {
    const c = clip('a', 1_000_000, 2_000_000)
    const next = rateStretchClip(c, 'end', 5_000_000, 1000)!
    expect(next).toMatchObject({
      startUs: 1_000_000,
      durationUs: 4_000_000,
      speed: 0.5,
      sourceInUs: 2_000_000
    })
  })

  it('kéo mép đầu thì mép cuối đứng yên; tốc độ kẹp ở 4×', () => {
    const c = clip('a', 1_000_000, 2_000_000)
    const next = rateStretchClip(c, 'start', 2_000_000, 1000)!
    expect(next).toMatchObject({ startUs: 2_000_000, durationUs: 1_000_000, speed: 2 })
    const capped = rateStretchClip(c, 'end', 1_000_001, 1000)!
    expect(capped).toMatchObject({ speed: 4, durationUs: 500_000 })
  })

  it('kéo mép đầu quá đầu timeline thì dừng ở 0', () => {
    const c = clip('a', 1_000_000, 2_000_000)
    const next = rateStretchClip(c, 'start', -5_000_000, 1000)!
    // Tốc độ lưu làm tròn 4 chữ số (0,6667×) nên độ dài lệch dưới một mili giây.
    expect(next.startUs).toBeLessThan(1000)
    expect(Math.abs(next.durationUs - 3_000_000)).toBeLessThan(1000)
  })
})
