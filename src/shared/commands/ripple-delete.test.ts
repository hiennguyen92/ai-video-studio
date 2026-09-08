import { describe, expect, it } from 'vitest'
import type { Clip } from '../domain/timeline-track-types'
import { clipEndUs } from '../domain/timeline-track-types'
import { rippleDeleteRange } from './timeline-mutations'

/**
 * Cắt bỏ một khoảng rồi kéo phần sau lùi lên lấp chỗ trống.
 *
 * Đây là thao tác dựng phim mà trước giờ dự án chưa có, và là thứ một agent cần
 * để bỏ đoạn thừa. Điều dễ sai nhất: dời NHẦM những clip chỉ bị cắt đuôi — mép
 * đầu của chúng vẫn phải nằm nguyên chỗ cũ.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`
const options = { makeId }

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

const layout = (clips: Clip[]): Array<[string, number, number]> =>
  clips.map((item) => [item.id, item.startUs, clipEndUs(item)])

describe('rippleDeleteRange', () => {
  it('xoá clip nằm trọn trong khoảng và kéo clip sau lùi lên', () => {
    const result = rippleDeleteRange(
      [clip('a', 0, 2_000_000), clip('b', 2_000_000, 2_000_000), clip('c', 4_000_000, 2_000_000)],
      2_000_000,
      4_000_000,
      options
    )

    // "b" biến mất, "c" lùi lên đúng chỗ "b" vừa để lại.
    expect(layout(result)).toEqual([
      ['a', 0, 2_000_000],
      ['c', 2_000_000, 4_000_000]
    ])
  })

  it('clip bị cắt đuôi thì GIỮ NGUYÊN mép đầu, không bị dời', () => {
    const result = rippleDeleteRange(
      [clip('a', 0, 5_000_000), clip('b', 6_000_000, 1_000_000)],
      3_000_000,
      6_000_000,
      options
    )

    expect(layout(result)).toEqual([
      ['a', 0, 3_000_000],
      ['b', 3_000_000, 4_000_000]
    ])
  })

  it('khoảng nằm gọn giữa một clip thì hai nửa nối liền lại', () => {
    const result = rippleDeleteRange([clip('a', 0, 10_000_000)], 4_000_000, 6_000_000, options)

    expect(result).toHaveLength(2)
    // Nửa sau phải dính sát nửa trước — không còn khe hở.
    expect(result[0].startUs).toBe(0)
    expect(clipEndUs(result[0])).toBe(4_000_000)
    expect(result[1].startUs).toBe(4_000_000)
    expect(clipEndUs(result[1])).toBe(8_000_000)
  })

  it('nửa sau giữ đúng điểm vào nguồn, không phát lại nội dung đã bỏ', () => {
    const result = rippleDeleteRange([clip('a', 0, 10_000_000)], 4_000_000, 6_000_000, options)

    // Bỏ giây 4–6 của nguồn, nên nửa sau phải bắt đầu đọc từ giây 6.
    expect(result[1].sourceInUs).toBe(6_000_000)
  })

  it('tôn trọng tốc độ phát khi tính điểm vào nguồn', () => {
    const fast = { ...clip('a', 0, 10_000_000), speed: 2 }
    const result = rippleDeleteRange([fast], 4_000_000, 6_000_000, options)

    // Chạy 2x: 2 giây timeline tiêu tốn 4 giây nguồn, cộng vào 4×2 = 8 của phần đầu.
    expect(result[1].sourceInUs).toBe(12_000_000)
  })

  it('không đụng gì tới clip nằm hoàn toàn trước khoảng xoá', () => {
    const result = rippleDeleteRange(
      [clip('a', 0, 1_000_000), clip('b', 5_000_000, 1_000_000)],
      2_000_000,
      3_000_000,
      options
    )
    expect(result[0]).toEqual(clip('a', 0, 1_000_000))
  })

  it('bỏ qua khoảng rỗng thay vì dời nhầm mọi thứ', () => {
    const clips = [clip('a', 0, 1_000_000)]
    expect(rippleDeleteRange(clips, 5_000_000, 5_000_000, options)).toBe(clips)
    expect(rippleDeleteRange(clips, 6_000_000, 5_000_000, options)).toBe(clips)
  })

  it('xoá nhiều clip liền nhau trong một lần', () => {
    const result = rippleDeleteRange(
      [
        clip('a', 0, 1_000_000),
        clip('b', 1_000_000, 1_000_000),
        clip('c', 2_000_000, 1_000_000),
        clip('d', 3_000_000, 1_000_000)
      ],
      1_000_000,
      3_000_000,
      options
    )

    expect(layout(result)).toEqual([
      ['a', 0, 1_000_000],
      ['d', 1_000_000, 2_000_000]
    ])
  })

  it('kết quả luôn sắp xếp tăng dần và không chồng lấn', () => {
    const result = rippleDeleteRange(
      [clip('a', 0, 4_000_000), clip('b', 4_000_000, 4_000_000), clip('c', 8_000_000, 4_000_000)],
      2_000_000,
      9_000_000,
      options
    )

    for (let index = 1; index < result.length; index += 1) {
      expect(result[index].startUs).toBeGreaterThanOrEqual(clipEndUs(result[index - 1]))
    }
  })
})
