import { describe, expect, it } from 'vitest'
import { easeProgress, resolveKeyframeTrack, valueAtFrame } from './keyframe-interpolation'
import { normalizeKeyframeTrack, type Keyframe, type ResolvedKeyframeTrack } from './keyframe-types'
import type { FrameRate } from './time-units'

/**
 * Nội suy keyframe.
 *
 * Đây là phần chạy MỖI KHUNG HÌNH ở cả bản xem trước lẫn lúc xuất file, nên mọi
 * phép thử ở đây đều chốt bằng CON SỐ cụ thể, không chỉ "khác nhau là được".
 */

const FPS_30: FrameRate = { num: 30, den: 1 }

/** Dựng đường keyframe đã quy về khung, cho gọn phần thân phép thử. */
function atFrames(
  ...items: Array<[frame: number, value: number, easing?: Keyframe['e']]>
): ResolvedKeyframeTrack {
  return items.map(([f, v, e]) => ({ f, v, e: e ?? ('linear' as const) }))
}

describe('giá trị của đường keyframe tại một khung', () => {
  it('không có keyframe nào thì trả giá trị tĩnh', () => {
    // Clip chưa động gì phải y hệt như trước khi có tính năng này.
    expect(valueAtFrame(undefined, 10, 0.42)).toBe(0.42)
    expect(valueAtFrame([], 10, 0.42)).toBe(0.42)
  })

  it('một keyframe duy nhất KHOÁ CỨNG giá trị cho mọi khung', () => {
    // Không phải "chưa động gì nên lấy giá trị tĩnh": bấm kim cương một lần là
    // người dùng đã tuyên bố giá trị tại đó.
    const track = atFrames([15, 0.3])
    expect(valueAtFrame(track, 0, 1)).toBe(0.3)
    expect(valueAtFrame(track, 15, 1)).toBe(0.3)
    expect(valueAtFrame(track, 999, 1)).toBe(0.3)
    // Khung âm vẫn xảy ra: clip có chuyển cảnh bắt đầu sớm hơn mép của nó.
    expect(valueAtFrame(track, -5, 1)).toBe(0.3)
  })

  it('hai keyframe linear thì giữa đoạn cho đúng trung bình', () => {
    const track = atFrames([0, 0], [10, 1])
    expect(valueAtFrame(track, 5, 0)).toBeCloseTo(0.5, 10)
    expect(valueAtFrame(track, 2, 0)).toBeCloseTo(0.2, 10)
    expect(valueAtFrame(track, 0, 0)).toBe(0)
    expect(valueAtFrame(track, 10, 0)).toBe(1)
  })

  it('ngoài hai đầu thì kẹp, không ngoại suy', () => {
    const track = atFrames([10, 0.2], [20, 0.8])
    expect(valueAtFrame(track, 0, 0)).toBe(0.2)
    expect(valueAtFrame(track, 9, 0)).toBe(0.2)
    expect(valueAtFrame(track, 21, 0)).toBe(0.8)
    expect(valueAtFrame(track, 10_000, 0)).toBe(0.8)
  })

  it('hold giữ nguyên giá trị TRÁI tới đúng khung của keyframe phải rồi nhảy', () => {
    // Bài kiểm duy nhất phân biệt được "easing lấy từ keyframe trái" với "lấy từ
    // keyframe phải". Lấy nhầm bên là hold mất sạch tác dụng.
    const track = atFrames([0, 0, 'hold'], [10, 1])
    expect(valueAtFrame(track, 0, 0)).toBe(0)
    expect(valueAtFrame(track, 5, 0)).toBe(0)
    expect(valueAtFrame(track, 9, 0)).toBe(0)
    expect(valueAtFrame(track, 10, 0)).toBe(1)
  })

  it('ease-in chậm lúc đầu, ease-out nhanh lúc đầu', () => {
    const easeIn = atFrames([0, 0, 'ease-in'], [10, 1])
    const easeOut = atFrames([0, 0, 'ease-out'], [10, 1])
    expect(valueAtFrame(easeIn, 5, 0)).toBeCloseTo(0.25, 10)
    expect(valueAtFrame(easeOut, 5, 0)).toBeCloseTo(0.75, 10)
    // Hai đầu vẫn phải khớp đúng giá trị keyframe, không được lệch vì easing.
    expect(valueAtFrame(easeIn, 0, 0)).toBe(0)
    expect(valueAtFrame(easeIn, 10, 0)).toBe(1)
  })

  it('ease-in-out đối xứng quanh giữa đoạn', () => {
    const track = atFrames([0, 0, 'ease-in-out'], [10, 1])
    expect(valueAtFrame(track, 5, 0)).toBeCloseTo(0.5, 10)
    expect(valueAtFrame(track, 2, 0)).toBeCloseTo(0.08, 10)
    expect(valueAtFrame(track, 8, 0)).toBeCloseTo(0.92, 10)
  })

  it('hold ở đoạn GIỮA vẫn nhảy đúng tại keyframe phải', () => {
    // Đoạn giữa không đi qua nhánh kẹp hai đầu, nên đây là chỗ duy nhất lộ ra
    // lỗi "t = 1 mà tiến độ vẫn 0": thiếu nhánh trúng-đúng-khung thì giá trị
    // đứng nguyên ở 0.2 và không bao giờ nhảy lên 0.9.
    const track = atFrames([0, 0], [10, 0.2, 'hold'], [20, 0.9], [30, 1])
    expect(valueAtFrame(track, 15, 0)).toBe(0.2)
    expect(valueAtFrame(track, 19, 0)).toBe(0.2)
    expect(valueAtFrame(track, 20, 0)).toBe(0.9)
  })

  it('mỗi đoạn dùng easing riêng của keyframe mở đầu đoạn đó', () => {
    const track = atFrames([0, 0, 'hold'], [10, 1, 'linear'], [20, 0])
    expect(valueAtFrame(track, 5, 0)).toBe(0)
    expect(valueAtFrame(track, 15, 0)).toBeCloseTo(0.5, 10)
  })

  it('hai keyframe rơi vào CÙNG một khung không sinh NaN', () => {
    // fps thấp + hai mốc cách nhau vài mili giây. NaN lọt vào CSS là cả clip
    // biến mất mà không có lỗi nào chỉ ra.
    const track = atFrames([12, 0.2], [12, 0.9], [30, 1])
    const value = valueAtFrame(track, 12, 0)
    expect(Number.isNaN(value)).toBe(false)
    // Bản đặt sau thắng, nên giá trị tại khung 12 nối liền với đoạn đi ra chứ
    // không hụt xuống 0.2 đúng một khung rồi vọt lên.
    expect(value).toBe(0.9)
    expect(valueAtFrame(track, 13, 0)).toBeGreaterThan(0.9)

    // Cùng chuyện đó nhưng bản trùng nằm ở GIỮA đường, không phải ngay đầu.
    const inner = atFrames([0, 0], [12, 0.2], [12, 0.9], [30, 1])
    expect(valueAtFrame(inner, 12, 0)).toBe(0.9)
  })
})

describe('đường cong easing', () => {
  it('cho đúng giá trị tại hai đầu và giữa', () => {
    for (const easing of ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'] as const) {
      expect(easeProgress(0, easing)).toBe(0)
    }
    expect(easeProgress(1, 'linear')).toBe(1)
    expect(easeProgress(1, 'ease-in')).toBe(1)
    expect(easeProgress(1, 'ease-out')).toBe(1)
    expect(easeProgress(1, 'ease-in-out')).toBe(1)
    // hold là ngoại lệ có chủ ý: nó không bao giờ tiến tới giá trị phải, chính
    // chỗ đánh giá mới nhảy sang keyframe phải khi chạm đúng khung của nó.
    expect(easeProgress(1, 'hold')).toBe(0)
  })
})

describe('chuẩn hoá đường keyframe', () => {
  it('sắp lại mảng đưa vào lộn xộn', () => {
    const track = normalizeKeyframeTrack(
      [
        { atUs: 2_000_000, v: 1 },
        { atUs: 0, v: 0 },
        { atUs: 1_000_000, v: 0.5 }
      ],
      0,
      1
    )
    expect(track.map((frame) => frame.atUs)).toEqual([0, 1_000_000, 2_000_000])
  })

  it('trùng mốc thì bản ĐẶT SAU thắng', () => {
    // Đặt lại keyframe ngay tại đầu phát là thao tác thường xuyên; người dùng
    // hiểu nó là ghi đè, không phải thêm cái thứ hai vào cùng một chỗ.
    const track = normalizeKeyframeTrack(
      [
        { atUs: 500_000, v: 0.2 },
        { atUs: 500_000, v: 0.9, e: 'hold' }
      ],
      0,
      1
    )
    expect(track).toEqual([{ atUs: 500_000, v: 0.9, e: 'hold' }])
  })

  it('kẹp giá trị ngoài khoảng hợp lệ', () => {
    const track = normalizeKeyframeTrack(
      [
        { atUs: 0, v: -3 },
        { atUs: 1_000, v: 40 }
      ],
      0,
      1
    )
    expect(track.map((frame) => frame.v)).toEqual([0, 1])
  })

  it('bỏ keyframe có số hỏng thay vì để NaN chui vào tài liệu', () => {
    const track = normalizeKeyframeTrack(
      [
        { atUs: 0, v: Number.NaN },
        { atUs: Number.POSITIVE_INFINITY, v: 1 },
        { atUs: 1_000, v: 0.5 }
      ],
      0,
      1
    )
    expect(track).toEqual([{ atUs: 1_000, v: 0.5 }])
  })

  it('không ghi khoá easing khi là linear', () => {
    // Mặc định đã là linear; ghi ra chỉ làm file dự án phình.
    const track = normalizeKeyframeTrack([{ atUs: 0, v: 1, e: 'linear' }], 0, 1)
    expect(track).toEqual([{ atUs: 0, v: 1 }])
    expect('e' in track[0]).toBe(false)
  })
})

describe('quy đổi đường keyframe sang khung hình', () => {
  it('đổi micro giây thành số khung và điền easing mặc định', () => {
    const resolved = resolveKeyframeTrack(
      [
        { atUs: 0, v: 0 },
        { atUs: 500_000, v: 1 }
      ],
      FPS_30
    )
    expect(resolved).toEqual([
      { f: 0, v: 0, e: 'linear' },
      { f: 15, v: 1, e: 'linear' }
    ])
  })

  it('cộng phần khung dôi ra của chuyển cảnh', () => {
    // Clip có chuyển cảnh vào thì Sequence bắt đầu SỚM hơn mép clip, và
    // `useCurrentFrame()` đếm từ chỗ sớm đó. Không bù thì chuyển động chạy sớm
    // đúng bằng độ dài chuyển cảnh — 15 khung, tức nửa giây ở 30fps.
    const resolved = resolveKeyframeTrack([{ atUs: 0, v: 0 }], FPS_30, 15)
    expect(resolved?.[0].f).toBe(15)
  })

  it('đường rỗng trả undefined để chỗ vẽ bỏ qua hẳn', () => {
    expect(resolveKeyframeTrack(undefined, FPS_30)).toBeUndefined()
    expect(resolveKeyframeTrack([], FPS_30)).toBeUndefined()
  })
})
