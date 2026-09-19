import { describe, expect, it } from 'vitest'
import { parseWindowPeaks, suggestSilenceThreshold } from './audio-level-analysis'

describe('parseWindowPeaks', () => {
  it('đọc đỉnh từng cửa sổ, im tuyệt đối (-inf) quy về -120 dB', () => {
    expect(
      parseWindowPeaks(
        'frame:0\nlavfi.astats.Overall.Peak_level=-21.5\nframe:1\nlavfi.astats.Overall.Peak_level=-inf\n'
      )
    ).toEqual([-21.5, -120])
  })
})

describe('suggestSilenceThreshold', () => {
  const windows = (noise: number, speech: number, speechShare: number): number[] =>
    Array.from({ length: 100 }, (_, index) => (index < speechShare * 100 ? speech : noise))

  it('phòng yên tĩnh: ngưỡng thấp, cách xa lời nói', () => {
    const result = suggestSilenceThreshold(windows(-60, -8, 0.5))!
    expect(result.noiseFloorDb).toBe(-60)
    expect(result.thresholdDb).toBeGreaterThan(-60)
    expect(result.thresholdDb).toBeLessThan(-35)
  })

  it('phòng ồn: ngưỡng nằm TRÊN đỉnh nhiễu và DƯỚI lời nói', () => {
    const result = suggestSilenceThreshold(windows(-22, -7, 0.5))!
    expect(result.thresholdDb).toBeGreaterThan(-22)
    expect(result.thresholdDb).toBeLessThan(-7)
  })

  it('nói liền không nghỉ: ngưỡng dưới nền, không cắt âm tiết nào', () => {
    const result = suggestSilenceThreshold(windows(-14, -8, 0.5))!
    expect(result.thresholdDb).toBeLessThan(result.noiseFloorDb)
  })

  it('im tuyệt đối không kéo ngưỡng xuống -110 dB', () => {
    expect(suggestSilenceThreshold(windows(-120, -10, 0.5))!.noiseFloorDb).toBe(-90)
  })

  it('không có dữ liệu thì không đề xuất', () => {
    expect(suggestSilenceThreshold([])).toBeNull()
  })
})
