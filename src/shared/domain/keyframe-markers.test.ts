import { describe, expect, it } from 'vitest'
import { keyframeMarkers } from './keyframe-markers'

describe('gộp keyframe thành mốc trên timeline', () => {
  it('không có gì thì không có mốc nào', () => {
    expect(keyframeMarkers(undefined)).toEqual([])
    expect(keyframeMarkers({})).toEqual([])
  })

  it('nhiều thuộc tính tại cùng một mốc gộp thành MỘT chấm', () => {
    // Đặt keyframe cho vị trí là hai đường (hai trục) nhưng người dùng thấy một
    // thao tác, nên trên timeline cũng phải thấy một chấm.
    const markers = keyframeMarkers({
      'transform.x': [{ atUs: 0, v: 0 }],
      'transform.y': [{ atUs: 0, v: 0 }],
      'transform.opacity': [{ atUs: 1_000_000, v: 1 }]
    })
    expect(markers).toHaveLength(2)
    expect(markers[0].atUs).toBe(0)
    expect(markers[0].paths.sort()).toEqual(['transform.x', 'transform.y'])
    expect(markers[1].paths).toEqual(['transform.opacity'])
  })

  it('mốc sắp tăng dần theo thời gian', () => {
    const markers = keyframeMarkers({
      'transform.x': [
        { atUs: 2_000_000, v: 1 },
        { atUs: 0, v: 0 }
      ]
    })
    expect(markers.map((marker) => marker.atUs)).toEqual([0, 2_000_000])
  })

  it('kiểu nội suy chung thì ghi ra, khác nhau thì đánh dấu lẫn lộn', () => {
    // Menu chuột phải cần biết: mốc đang dùng một kiểu thì tích vào kiểu đó,
    // lẫn lộn thì không tích cái nào.
    const same = keyframeMarkers({
      'transform.x': [{ atUs: 0, v: 0, e: 'hold' }],
      'transform.y': [{ atUs: 0, v: 0, e: 'hold' }]
    })
    expect(same[0].easing).toBe('hold')

    const mixed = keyframeMarkers({
      'transform.x': [{ atUs: 0, v: 0, e: 'hold' }],
      'transform.y': [{ atUs: 0, v: 0 }]
    })
    expect(mixed[0].easing).toBe('mixed')
  })
})
