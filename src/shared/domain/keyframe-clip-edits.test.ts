import { describe, expect, it } from 'vitest'
import {
  cloneKeyframes,
  compactKeyframes,
  hasAnyKeyframe,
  pruneEffectKeyframes,
  scaleKeyframes,
  shiftKeyframes,
  splitKeyframes
} from './keyframe-clip-edits'
import type { KeyframeTracks } from './keyframe-types'

/**
 * Keyframe đi theo clip khi clip bị sửa.
 *
 * Mỗi phép thử ở đây tương ứng đúng một thao tác người dùng làm trên timeline —
 * cắt mép, đổi tốc độ, tách đôi, nhân bản — chứ không kiểm từng hàm một cách
 * trừu tượng.
 */

const tracks = (): KeyframeTracks => ({
  'transform.opacity': [
    { atUs: 0, v: 0 },
    { atUs: 2_000_000, v: 1 }
  ]
})

describe('cắt mép đầu clip', () => {
  it('dời mọi mốc đi đúng đoạn vừa cắt', () => {
    // Mốc tính từ mép đầu, nên mép đầu dời 1 giây thì mọi mốc lùi 1 giây —
    // không thì cả chuyển động trôi đi đúng bằng đoạn vừa cắt.
    const shifted = shiftKeyframes(tracks(), -1_000_000)
    expect(shifted?.['transform.opacity'].map((frame) => frame.atUs)).toEqual([
      -1_000_000, 1_000_000
    ])
  })

  it('cắt vào rồi kéo trả ra thì mốc về đúng chỗ cũ', () => {
    // Vì vậy mốc âm được GIỮ chứ không xoá: cắt mép là thao tác đảo được, và
    // lịch sử hoàn tác không cứu nổi nếu người dùng đã làm mười việc khác ở giữa.
    const there = shiftKeyframes(tracks(), -1_500_000)
    const back = shiftKeyframes(there, 1_500_000)
    expect(back).toEqual(tracks())
  })
})

describe('đổi tốc độ clip', () => {
  it('co mốc theo đúng tỉ lệ độ dài mới', () => {
    // Phát nhanh gấp đôi: keyframe ở giây thứ 2 phải về giây thứ 1, nếu không
    // chuyển động dồn hết về nửa đầu còn nửa sau đứng hình.
    const scaled = scaleKeyframes(tracks(), 4_000_000, 2_000_000)
    expect(scaled?.['transform.opacity'].map((frame) => frame.atUs)).toEqual([0, 1_000_000])
  })

  it('độ dài không đổi thì không đụng gì', () => {
    const same = tracks()
    expect(scaleKeyframes(same, 4_000_000, 4_000_000)).toBe(same)
  })
})

describe('tách đôi clip', () => {
  it('mỗi nửa nhận một keyframe ở chỗ nối, cùng một giá trị', () => {
    // Không chèn điểm nối thì nửa đầu giữ nguyên giá trị của keyframe cuối cùng
    // trước điểm cắt, còn nửa sau bắt đầu ở keyframe sau điểm cắt — giá trị nhảy
    // bậc đúng chỗ vừa cắt, và chuyển động giật một cái ai cũng thấy.
    const { head, tail } = splitKeyframes(tracks(), 1_000_000)
    const headTrack = head!['transform.opacity']
    const tailTrack = tail!['transform.opacity']

    expect(headTrack.map((frame) => frame.atUs)).toEqual([0, 1_000_000])
    expect(tailTrack.map((frame) => frame.atUs)).toEqual([0, 1_000_000])
    // Điểm cắt nằm giữa 0 và 2 giây của đoạn 0 → 1, nên giá trị ở đó là 0.5.
    expect(headTrack[1].v).toBeCloseTo(0.5, 10)
    expect(tailTrack[0].v).toBeCloseTo(0.5, 10)
    // Và hai bên khớp nhau: đó mới là điều làm chỗ nối không giật.
    expect(headTrack[1].v).toBe(tailTrack[0].v)
  })

  it('điểm cắt ngoài vùng có keyframe thì không chèn gì thêm', () => {
    const { head, tail } = splitKeyframes(tracks(), 3_000_000)
    expect(head!['transform.opacity']).toHaveLength(2)
    expect(tail?.['transform.opacity']).toBeUndefined()
  })

  it('giữ kiểu nội suy của đoạn bị cắt làm đôi', () => {
    const held: KeyframeTracks = {
      'transform.opacity': [
        { atUs: 0, v: 0, e: 'hold' },
        { atUs: 2_000_000, v: 1 }
      ]
    }
    const { head, tail } = splitKeyframes(held, 1_000_000)
    // hold nghĩa là giá trị đứng yên tới tận keyframe phải, nên điểm nối mang
    // giá trị 0 chứ không phải 0.5 — và cả hai nửa phải nhớ điều đó.
    expect(head!['transform.opacity'][1].v).toBe(0)
    expect(head!['transform.opacity'][1].e).toBe('hold')
    expect(tail!['transform.opacity'][0].v).toBe(0)
  })
})

describe('gỡ effect', () => {
  it('dọn keyframe của effect không còn trong chồng', () => {
    const withEffects: KeyframeTracks = {
      'effect.e1.intensity': [{ atUs: 0, v: 0.5 }],
      'effect.e2.params.width': [{ atUs: 0, v: 30 }],
      'transform.opacity': [{ atUs: 0, v: 1 }]
    }
    const pruned = pruneEffectKeyframes(withEffects, [
      { id: 'e1', kind: 'soft-blur', intensity: 0.5, params: {} }
    ])
    expect(Object.keys(pruned ?? {})).toEqual(['effect.e1.intensity', 'transform.opacity'])
  })

  it('gỡ hết effect có keyframe thì trường keyframes biến mất hẳn', () => {
    const only: KeyframeTracks = { 'effect.e1.intensity': [{ atUs: 0, v: 1 }] }
    expect(pruneEffectKeyframes(only, [])).toBeUndefined()
  })
})

describe('nhân bản clip', () => {
  it('bản sao không dùng chung mảng với bản gốc', () => {
    const original = tracks()
    const copy = cloneKeyframes(original)!
    copy['transform.opacity'][0].v = 0.9
    copy['transform.opacity'].push({ atUs: 9_000_000, v: 0 })

    expect(original['transform.opacity'][0].v).toBe(0)
    expect(original['transform.opacity']).toHaveLength(2)
  })
})

describe('dọn khoá rỗng', () => {
  it('đường rỗng bị bỏ, hết sạch thì trả undefined', () => {
    expect(
      compactKeyframes({ 'transform.opacity': [], 'transform.x': [{ atUs: 0, v: 1 }] })
    ).toEqual({ 'transform.x': [{ atUs: 0, v: 1 }] })
    expect(compactKeyframes({ 'transform.opacity': [] })).toBeUndefined()
    expect(compactKeyframes(undefined)).toBeUndefined()
  })

  it('nhận ra chủ thể có keyframe hay không', () => {
    expect(hasAnyKeyframe({})).toBe(false)
    expect(hasAnyKeyframe({ keyframes: {} })).toBe(false)
    // Khoá còn đó nhưng đường rỗng vẫn tính là KHÔNG có: cổng chọn bộ dựng đọc
    // hàm này, và một khoá rỗng không làm bản xuất đổi gì.
    expect(hasAnyKeyframe({ keyframes: { 'transform.x': [] } })).toBe(false)
    expect(hasAnyKeyframe({ keyframes: tracks() })).toBe(true)
  })
})
