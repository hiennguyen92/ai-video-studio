import type { Keyframe } from './keyframe-types'
import type { Micros } from './time-units'

/**
 * Đường bao âm lượng của nhạc nền theo GIỜ TRÊN TIMELINE, rồi cắt ra thành
 * keyframe cho từng clip.
 *
 * Dựng một đường chung cho cả timeline trước, cắt sau — chứ không tính riêng
 * từng clip — vì một đoạn dốc có thể vắt qua chỗ nối hai clip nhạc. Tính riêng
 * thì mỗi clip tự bắt đầu dốc từ đầu, và chỗ nối nghe ra một cú nhảy bậc. Cắt từ
 * đường chung thì giá trị ở mép cuối clip trước đúng bằng giá trị ở mép đầu clip
 * sau.
 */

export interface DuckInterval {
  startUs: Micros
  endUs: Micros
}

interface EnvelopePoint {
  atUs: Micros
  v: number
}

/**
 * Dốc ngắn nhất được phép.
 *
 * Dốc bằng 0 sinh hai keyframe trùng mốc, mà chuẩn hoá giữ bản sau — đoạn hạ
 * biến mất lặng lẽ. Dưới vài khung hình thì hai mốc làm tròn về cùng một khung,
 * tai nghe ra tiếng "bụp". 100 ms là hơn hai khung ở 24 fps.
 */
export const MIN_DUCK_RAMP_US: Micros = 100_000

/**
 * Các điểm gãy của đường bao: nền → dốc xuống → giữ mức thấp → dốc lên → nền.
 *
 * Dốc nằm NGOÀI khoảng đã nới: nhạc phải XUỐNG HẲN tại mép khoảng, nên chữ đầu
 * câu không bao giờ nằm trên đoạn nhạc đang hạ dở. Hai khoảng cách nhau chưa đủ
 * cho hai dốc thì gộp làm một — nhạc lên rồi xuống lại trong chưa tới một giây
 * nghe như ai đang vặn núm chơi.
 */
export function buildDuckEnvelope(
  intervals: readonly DuckInterval[],
  rampUs: Micros,
  duckVolume: number,
  baseVolume: number
): EnvelopePoint[] {
  const ramp = Math.max(MIN_DUCK_RAMP_US, rampUs)

  const joined: DuckInterval[] = []
  for (const interval of intervals) {
    const last = joined.at(-1)
    if (last && interval.startUs - last.endUs < ramp * 2) {
      last.endUs = Math.max(last.endUs, interval.endUs)
    } else {
      joined.push({ ...interval })
    }
  }

  return joined.flatMap((interval) => [
    { atUs: interval.startUs - ramp, v: baseVolume },
    { atUs: interval.startUs, v: duckVolume },
    { atUs: interval.endUs, v: duckVolume },
    { atUs: interval.endUs + ramp, v: baseVolume }
  ])
}

/** Giá trị đường bao tại `atUs`, nội suy thẳng; ngoài mọi điểm gãy là mức nền. */
export function envelopeValueAt(
  envelope: readonly EnvelopePoint[],
  atUs: Micros,
  baseVolume: number
): number {
  for (let index = 0; index < envelope.length; index += 1) {
    const point = envelope[index]
    if (atUs < point.atUs) {
      const previous = envelope[index - 1]
      // Trước điểm gãy đầu tiên, hoặc nằm giữa hai cụm hạ: đều là mức nền.
      if (!previous) return baseVolume
      const t = (atUs - previous.atUs) / (point.atUs - previous.atUs)
      return previous.v + (point.v - previous.v) * t
    }
    if (atUs === point.atUs) return point.v
  }
  return baseVolume
}

/**
 * Cắt đường bao cho một clip nằm ở `[startUs, endUs)` trên timeline.
 *
 * Trả keyframe theo OFFSET từ mép đầu clip — đúng hệ toạ độ của keyframe. Trả
 * `null` khi clip không dính đoạn hạ nào: clip đó chỉ cần mức nền tĩnh, gắn thêm
 * một đường keyframe phẳng chỉ làm dải chấm dưới clip rối mắt.
 */
export function envelopeKeyframesForClip(
  envelope: readonly EnvelopePoint[],
  startUs: Micros,
  endUs: Micros,
  baseVolume: number
): Keyframe[] | null {
  const points: EnvelopePoint[] = [
    { atUs: startUs, v: envelopeValueAt(envelope, startUs, baseVolume) },
    ...envelope.filter((point) => point.atUs > startUs && point.atUs < endUs),
    { atUs: endUs, v: envelopeValueAt(envelope, endUs, baseVolume) }
  ]

  if (points.every((point) => point.v === baseVolume)) return null

  // Bỏ điểm nằm giữa hai điểm cùng giá trị: nó không đổi gì về tiếng.
  const kept = points.filter((point, index) => {
    const before = points[index - 1]
    const after = points[index + 1]
    return !before || !after || before.v !== point.v || after.v !== point.v
  })

  return kept.map((point) => ({ atUs: Math.round(point.atUs - startUs), v: point.v }))
}
