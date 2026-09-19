import { describe, expect, it } from 'vitest'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import { clipsInMarquee, marqueeFromPoints } from './timeline-marquee-hits'

const clip = (id: string, startS: number, durationS: number): Clip =>
  ({ id, startUs: startS * 1_000_000, durationUs: durationS * 1_000_000 }) as Clip

const track = (id: string, clips: Clip[], locked = false): Track =>
  ({ id, clips, locked }) as Track

// 100 px mỗi giây; lane hình ở y 0–60, lane tiếng ở y 60–120.
const rows = [
  { track: track('hinh', [clip('a', 0, 2), clip('b', 3, 2)]), top: 0, bottom: 60 },
  { track: track('tieng', [clip('c', 1, 1)]), top: 60, bottom: 120 }
]

describe('clipsInMarquee', () => {
  it('chạm một phần là chọn, như Premiere: khung 150–320 px lấy cả a lẫn b', () => {
    const rect = marqueeFromPoints({ x: 150, y: 10 }, { x: 320, y: 40 })
    expect(clipsInMarquee(rows, rect, 100)).toEqual(['a', 'b'])
  })

  it('kéo ngược lên trái vẫn ra đúng khung, và khung trải hai lane lấy clip cả hai lane', () => {
    const rect = marqueeFromPoints({ x: 160, y: 100 }, { x: 50, y: 20 })
    expect(clipsInMarquee(rows, rect, 100)).toEqual(['a', 'c'])
  })

  it('khung nằm trong khe giữa hai clip: không chọn gì', () => {
    const rect = marqueeFromPoints({ x: 210, y: 10 }, { x: 290, y: 50 })
    expect(clipsInMarquee(rows, rect, 100)).toEqual([])
  })

  it('bỏ qua lane khoá', () => {
    const locked = [{ ...rows[0], track: track('hinh', rows[0].track.clips, true) }, rows[1]]
    const rect = marqueeFromPoints({ x: 0, y: 0 }, { x: 600, y: 120 })
    expect(clipsInMarquee(locked, rect, 100)).toEqual(['c'])
  })
})
