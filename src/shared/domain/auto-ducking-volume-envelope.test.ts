import { describe, expect, it } from 'vitest'
import {
  buildDuckEnvelope,
  envelopeKeyframesForClip,
  envelopeValueAt,
  MIN_DUCK_RAMP_US
} from './auto-ducking-volume-envelope'

describe('buildDuckEnvelope', () => {
  it('dốc nằm ngoài khoảng: nhạc xuống hẳn đúng tại mép khoảng', () => {
    expect(buildDuckEnvelope([{ startUs: 1_000_000, endUs: 2_000_000 }], 200_000, 0.2, 1)).toEqual([
      { atUs: 800_000, v: 1 },
      { atUs: 1_000_000, v: 0.2 },
      { atUs: 2_000_000, v: 0.2 },
      { atUs: 2_200_000, v: 1 }
    ])
  })

  it('dốc bằng 0 bị kẹp lên mức tối thiểu, không sinh hai mốc trùng nhau', () => {
    const envelope = buildDuckEnvelope([{ startUs: 1_000_000, endUs: 2_000_000 }], 0, 0.2, 1)
    expect(envelope[1].atUs - envelope[0].atUs).toBe(MIN_DUCK_RAMP_US)
  })

  it('gộp hai khoảng cách nhau chưa đủ cho hai dốc', () => {
    const envelope = buildDuckEnvelope(
      [
        { startUs: 0, endUs: 1_000_000 },
        { startUs: 1_300_000, endUs: 2_000_000 }
      ],
      200_000,
      0.2,
      1
    )
    expect(envelope).toHaveLength(4)
  })
})

describe('envelopeValueAt', () => {
  const envelope = buildDuckEnvelope([{ startUs: 1_000_000, endUs: 2_000_000 }], 200_000, 0, 1)

  it('nội suy thẳng giữa dốc', () => {
    expect(envelopeValueAt(envelope, 900_000, 1)).toBeCloseTo(0.5)
  })

  it('ngoài đường bao là mức nền', () => {
    expect(envelopeValueAt(envelope, 0, 1)).toBe(1)
    expect(envelopeValueAt(envelope, 5_000_000, 1)).toBe(1)
  })
})

describe('envelopeKeyframesForClip', () => {
  const envelope = buildDuckEnvelope([{ startUs: 5_000_000, endUs: 6_000_000 }], 200_000, 0.2, 1)

  it('clip không dính đoạn hạ nào thì không cần keyframe', () => {
    expect(envelopeKeyframesForClip(envelope, 0, 3_000_000, 1)).toBeNull()
  })

  it('bỏ điểm thừa giữa đoạn phẳng', () => {
    const keyframes = envelopeKeyframesForClip(envelope, 5_200_000, 5_800_000, 1)
    expect(keyframes).toEqual([
      { atUs: 0, v: 0.2 },
      { atUs: 600_000, v: 0.2 }
    ])
  })
})
