import { describe, expect, it } from 'vitest'
import { glTransitionsOfTrack, isPlainEnoughForGl } from './gl-transition-plan'
import { trackTransitionFrames } from './cut-transition-fit'
import {
  DEFAULT_CLIP_TRANSFORM,
  DEFAULT_TRANSITION_DURATION_US,
  type Clip,
  type Track
} from './timeline-track-types'

/**
 * Chỗ nối chạy bằng WebGL.
 *
 * Khác mọi chuyển cảnh khác ở một điểm: nó là MỤC RIÊNG trong kế hoạch dựng, vì
 * nó trộn hai luồng hình nên phải biết cả hai phía cùng lúc. Chỗ dễ sai là điểm
 * vào nguồn: clip đến phải phát phần nguồn nằm TRƯỚC điểm vào của nó, đúng như
 * lớp vẽ CSS vẫn làm, không thì hình nhảy ngay lúc chuyển cảnh kết thúc.
 */

const FPS = { num: 30, den: 1 }
const FULL = 15

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip',
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 3_000_000,
    sourceInUs: 2_000_000,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...overrides
  }
}

function track(clips: Clip[], kind: Track['kind'] = 'video'): Track {
  return { id: 'track', kind, name: 'Video 1', clips, volume: 1 } as Track
}

/** Chỗ nối ở giây 3, cả hai phía đều có handle dư dả. */
function junction(kind: string, overrides: Partial<Clip> = {}): Track {
  const transition = { kind, durationUs: DEFAULT_TRANSITION_DURATION_US } as Clip['transitionIn']
  return track([
    clip({ id: 'trai', transitionOut: transition }),
    clip({ id: 'phai', startUs: 3_000_000, transitionIn: transition, ...overrides })
  ])
}

function planOf(source: Track): ReturnType<typeof glTransitionsOfTrack> {
  return glTransitionsOfTrack(source, trackTransitionFrames(source.clips, FPS), FPS, 0)
}

describe('chỗ nối WebGL trong kế hoạch dựng', () => {
  it('dựng một mục cho kiểu WebGL', () => {
    const [found] = planOf(junction('page-curl'))
    expect(found.kind).toBe('page-curl')
    // Chỗ nối ở giây 3 = khung 90; chuyển cảnh 15 khung nên bắt đầu ở khung 75.
    expect(found.fromFrame).toBe(75)
    expect(found.durationInFrames).toBe(FULL)
  })

  it('kiểu CSS KHÔNG đi qua đường WebGL', () => {
    // Dựng một context WebGL cho thứ CSS làm được là tốn công vô ích.
    expect(planOf(junction('fade'))).toHaveLength(0)
    expect(planOf(junction('soft-wipe-left'))).toHaveLength(0)
  })

  it('clip đến lùi điểm vào nguồn đúng bằng độ dài chuyển cảnh', () => {
    // Nguồn vào ở giây 2 = khung 60; lùi 15 khung còn 45. Không lùi thì hết chuyển
    // cảnh hình nhảy về sau đúng nửa giây.
    const [found] = planOf(junction('page-curl'))
    expect(found.incoming.sourceFromFrame).toBe(45)
  })

  it('clip đi đọc đúng khung nguồn ứng với lúc chuyển cảnh bắt đầu', () => {
    // Clip trái bắt đầu ở khung 0 với nguồn vào khung 60; tới khung 75 thì nguồn
    // đã chạy tới 135.
    const [found] = planOf(junction('page-curl'))
    expect(found.outgoing.sourceFromFrame).toBe(135)
  })

  it('clip đã chỉnh màu hay có effect thì để nguyên đường CSS', () => {
    // Lớp WebGL lấy pixel thẳng từ file, không biết gì về look và effect — đi qua
    // nó là giữa chuyển cảnh màu nhảy về gốc rồi nhảy lại.
    expect(planOf(junction('page-curl', { look: { id: 'noir', intensity: 1 } }))).toHaveLength(0)
    expect(
      planOf(junction('page-curl', { motion: { kind: 'zoom-in', intensity: 0.5 } }))
    ).toHaveLength(0)
  })

  it('chỗ nối bị kẹp về 0 khung thì không dựng lớp nào', () => {
    // Clip đến chưa cắt đầu: không có nguồn để lấn, nên không có chuyển cảnh.
    expect(planOf(junction('page-curl', { sourceInUs: 0 }))).toHaveLength(0)
  })

  it('ảnh tĩnh luôn đọc từ khung 0: nó không có trục thời gian nguồn', () => {
    const source = junction('page-curl')
    const images = track(source.clips, 'image')
    const [found] = glTransitionsOfTrack(
      images,
      trackTransitionFrames(images.clips, FPS, true),
      FPS,
      0
    )
    expect(found.outgoing).toMatchObject({ media: 'image', sourceFromFrame: 0 })
    expect(found.incoming).toMatchObject({ media: 'image', sourceFromFrame: 0 })
  })
})

describe('isPlainEnoughForGl', () => {
  it('clip trần thì được', () => {
    expect(isPlainEnoughForGl(clip())).toBe(true)
  })

  it('transform MẶC ĐỊNH vẫn tính là trần', () => {
    // Mọi clip chèn vào đều mang sẵn transform mặc định. Hỏi "có transform không"
    // thì câu trả lời luôn là có, và đường WebGL không bao giờ chạy.
    expect(isPlainEnoughForGl(clip({ transform: DEFAULT_CLIP_TRANSFORM }))).toBe(true)
    expect(isPlainEnoughForGl(clip({ transform: { ...DEFAULT_CLIP_TRANSFORM, scale: 1.2 } }))).toBe(
      false
    )
  })

  it('mọi thứ vẽ ở tầng DOM đều loại clip ra', () => {
    expect(isPlainEnoughForGl(clip({ effects: [] }))).toBe(true)
    expect(isPlainEnoughForGl(clip({ backgroundFill: { kind: 'blur', amount: 0.5 } }))).toBe(false)
  })
})
