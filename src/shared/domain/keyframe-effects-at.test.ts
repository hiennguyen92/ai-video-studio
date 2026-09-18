import { describe, expect, it } from 'vitest'
import { effectsAtFrame } from './keyframe-effects-at'
import { buildClipEffectsRender } from './clip-effect-render'
import { resolveClipProperty } from './keyframe-property-catalog'
import type { ClipEffect } from './clip-effect-types'
import type { Clip } from './timeline-track-types'
import type { ResolvedKeyframeTracks } from './keyframe-types'

/**
 * Thông số effect chạy theo keyframe.
 *
 * Hai thứ đáng kiểm: giá trị có đổi theo khung không, và keyframe có bám đúng
 * effect không khi một clip mang nhiều effect cùng loại hoặc bị đổi thứ tự.
 */

const blur = (id: string, intensity = 0.2): ClipEffect => ({
  id,
  kind: 'soft-blur',
  intensity,
  params: {}
})

const mosaic = (id: string): ClipEffect => ({
  id,
  kind: 'local-mosaic',
  intensity: 0.5,
  params: { x: 50, y: 80, width: 30, height: 20 }
})

const clipWith = (effects: ClipEffect[]): Clip =>
  ({
    id: 'c1',
    startUs: 0,
    durationUs: 1_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    effects
  }) as Clip

describe('chồng effect tại một khung', () => {
  it('không có keyframe effect nào thì trả về CHÍNH mảng cũ', () => {
    // Cùng tham chiếu, không chỉ bằng nhau: đây là đường của mọi clip có effect
    // trong mọi dự án hiện có, chạy mỗi khung hình. Dựng lại mảng ở đây là đổi
    // id bộ lọc mỗi khung và bắt Player dựng lại bộ lọc SVG liên tục.
    const effects = [blur('e1')]
    expect(effectsAtFrame(effects, undefined, 10)).toBe(effects)
    expect(
      effectsAtFrame(effects, { 'transform.opacity': [{ f: 0, v: 1, e: 'linear' }] }, 10)
    ).toBe(effects)
  })

  it('cường độ chạy theo keyframe', () => {
    const effects = [blur('e1')]
    const keyframes: ResolvedKeyframeTracks = {
      'effect.e1.intensity': [
        { f: 0, v: 0, e: 'linear' },
        { f: 60, v: 1, e: 'linear' }
      ]
    }
    expect(effectsAtFrame(effects, keyframes, 0)?.[0].intensity).toBe(0)
    expect(effectsAtFrame(effects, keyframes, 30)?.[0].intensity).toBeCloseTo(0.5, 10)
    expect(effectsAtFrame(effects, keyframes, 60)?.[0].intensity).toBe(1)
  })

  it('một thông số chạy, những thông số còn lại giữ nguyên', () => {
    const effects = [mosaic('e1')]
    const keyframes: ResolvedKeyframeTracks = {
      'effect.e1.params.height': [
        { f: 0, v: 20, e: 'linear' },
        { f: 10, v: 60, e: 'linear' }
      ]
    }
    const at5 = effectsAtFrame(effects, keyframes, 5)?.[0]
    expect(at5?.params.height).toBeCloseTo(40, 10)
    expect(at5?.params.x).toBe(50)
    expect(at5?.params.y).toBe(80)
    expect(at5?.params.width).toBe(30)
    // Cường độ không có keyframe thì giữ nguyên số tĩnh.
    expect(at5?.intensity).toBe(0.5)
  })

  it('hai effect CÙNG loại trên một clip: keyframe chỉ ăn vào đúng id được đặt', () => {
    const effects = [blur('e1', 0.2), blur('e2', 0.9)]
    const keyframes: ResolvedKeyframeTracks = {
      'effect.e2.intensity': [{ f: 0, v: 0.1, e: 'linear' }]
    }
    const at0 = effectsAtFrame(effects, keyframes, 0)!
    expect(at0[0].intensity).toBe(0.2)
    expect(at0[1].intensity).toBe(0.1)
  })

  it('đổi thứ tự effect thì keyframe vẫn bám đúng effect', () => {
    // Khoá mang `effectId` chứ không mang chỉ số mảng, chính vì giao diện cho
    // phép kéo đổi thứ tự — theo chỉ số thì keyframe lặng lẽ nhảy sang effect
    // khác và không cách nào truy ra.
    const keyframes: ResolvedKeyframeTracks = {
      'effect.e2.intensity': [{ f: 0, v: 0.1, e: 'linear' }]
    }
    const swapped = effectsAtFrame([blur('e2', 0.9), blur('e1', 0.2)], keyframes, 0)!
    expect(swapped[0].id).toBe('e2')
    expect(swapped[0].intensity).toBe(0.1)
    expect(swapped[1].intensity).toBe(0.2)
  })
})

describe('bộ lọc thật sự đổi theo khung', () => {
  it('hai khung khác nhau cho hai id bộ lọc khác nhau', () => {
    // Id băm theo NỘI DUNG bộ lọc, nên id đổi là bằng chứng chuỗi SVG đổi —
    // tức là hình trên màn hình đổi, không chỉ con số trong bộ nhớ.
    const keyframes: ResolvedKeyframeTracks = {
      'effect.e1.intensity': [
        { f: 0, v: 0.1, e: 'linear' },
        { f: 60, v: 1, e: 'linear' }
      ]
    }
    const context = { frame: 0, fps: 30, width: 320, height: 180 }
    const first = buildClipEffectsRender('c1', effectsAtFrame([blur('e1')], keyframes, 0), context)
    const later = buildClipEffectsRender('c1', effectsAtFrame([blur('e1')], keyframes, 45), {
      ...context,
      frame: 45
    })
    expect(first.filterId).not.toBe(later.filterId)
  })
})

describe('danh mục từ chối những thứ không nội suy được', () => {
  it('thông số kiểu màu', () => {
    // `duotone` có hai thông số màu. Màu không có "giá trị ở giữa" nào có nghĩa
    // trong hệ này, và để chuỗi lọt vào bộ lọc SVG là mở một bề mặt không cần mở.
    const clip = clipWith([{ id: 'e1', kind: 'duotone', intensity: 0.5, params: {} }])
    expect(resolveClipProperty(clip, 'effect.e1.params.shadowColor')).toBeNull()
  })

  it('thông số kiểu ô chọn', () => {
    const clip = clipWith([{ id: 'e1', kind: 'mirror', intensity: 1, params: { axis: 'x' } }])
    expect(resolveClipProperty(clip, 'effect.e1.params.axis')).toBeNull()
  })

  it('cường độ của effect vốn không có thanh cường độ', () => {
    // Mặt nạ chữ nhật không dùng cường độ; cho đặt keyframe ở đó là bày ra một
    // đường chuyển động không tác động tới cái gì.
    const clip = clipWith([
      { id: 'e1', kind: 'rect-mask', intensity: 1, params: { x: 50, y: 50, width: 60, height: 60 } }
    ])
    expect(resolveClipProperty(clip, 'effect.e1.intensity')).toBeNull()
    // Nhưng thông số SỐ của chính nó thì đặt được — đó mới là thứ có nghĩa.
    expect(resolveClipProperty(clip, 'effect.e1.params.width')).toEqual({
      min: 5,
      max: 100,
      staticValue: 60
    })
  })

  it('cường độ của effect CÓ thanh cường độ thì nhận', () => {
    const clip = clipWith([blur('e1', 0.4)])
    expect(resolveClipProperty(clip, 'effect.e1.intensity')).toEqual({
      min: 0,
      max: 1,
      staticValue: 0.4
    })
  })
})
