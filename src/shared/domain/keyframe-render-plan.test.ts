import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './project-document-factory'
import { buildRenderPlan } from './remotion-render-plan'
import { transformValuesAt } from './keyframe-transform-at'
import { DEFAULT_CLIP_TRANSFORM, type Clip } from './timeline-track-types'
import type { ProjectDocument } from './project-document-types'
import type { ResolvedKeyframeTracks } from './keyframe-types'

/**
 * Keyframe đi từ tài liệu ra tới lớp vẽ.
 *
 * Phần đáng kiểm nhất ở đây KHÔNG phải phép nội suy (phase 01 đã lo) mà là TRỤC
 * THỜI GIAN: mốc keyframe đếm từ mép clip, còn lớp vẽ đếm từ chỗ `<Sequence>`
 * bắt đầu — hai chỗ đó lệch nhau đúng bằng độ dài chuyển cảnh vào.
 */

function project(clip: Partial<Clip>): ProjectDocument {
  const document = createEmptyProject({ name: 't' })
  document.assets.push({
    id: 'a',
    kind: 'video',
    name: 'a',
    source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 30_000_000, hasVideo: true, hasAudio: false },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '',
    missing: false
  } as never)
  const track = document.tracks.find((item) => item.kind === 'video')!
  track.clips.push({
    id: 'c1',
    assetId: 'a',
    startUs: 2_000_000,
    durationUs: 4_000_000,
    // Có sẵn vật liệu trước điểm vào, để chuyển cảnh có chỗ mà "ăn".
    sourceInUs: 5_000_000,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...clip
  })
  return document
}

const opacityTrack = { 'transform.opacity': [{ atUs: 1_000_000, v: 0.5 }] }

describe('đưa keyframe vào kế hoạch dựng hình', () => {
  it('clip không có keyframe thì kế hoạch cũng không mang gì', () => {
    const plan = buildRenderPlan(project({}))
    expect(plan.video[0].keyframes).toBeUndefined()
  })

  it('mốc micro giây quy thành số khung', () => {
    // 30fps, mốc ở giây thứ 1 → khung 30.
    const plan = buildRenderPlan(project({ keyframes: opacityTrack }))
    expect(plan.video[0].keyframes?.['transform.opacity']).toEqual([{ f: 30, v: 0.5, e: 'linear' }])
  })

  it('CLIP CÓ CHUYỂN CẢNH: mốc được đẩy thêm đúng số khung chuyển cảnh', () => {
    // Đây là bài kiểm quan trọng nhất của phase này.
    //
    // `<Sequence>` của clip có chuyển cảnh bắt đầu SỚM hơn mép clip nửa giây để
    // phủ lên clip phía trước, và `useCurrentFrame()` đếm từ chỗ sớm đó. Mốc
    // keyframe thì đếm từ mép clip. Không cộng bù thì cùng một keyframe sẽ chạy
    // sớm 15 khung — thấy rõ trên màn hình nhưng không đoán nổi nguyên nhân.
    const plan = buildRenderPlan(
      project({
        keyframes: opacityTrack,
        transitionIn: { kind: 'fade', durationUs: 500_000 }
      })
    )
    expect(plan.video[0].transition?.frames).toBe(15)
    expect(plan.video[0].keyframes?.['transform.opacity'][0].f).toBe(45)
  })

  it('kế hoạch mang theo số khung dôi ra, để chuyển động dựng sẵn cũng tính từ mép clip', () => {
    // `keyframes` đã cộng sẵn phần dôi, nhưng `motion` thì lớp vẽ tự tính mỗi
    // khung nên nó cần con số này. Trước đây chuyển động của clip có chuyển cảnh
    // khởi động sớm nửa giây — đúng lỗi mà bù lead-in sinh ra để tránh.
    const withTransition = buildRenderPlan(
      project({ transitionIn: { kind: 'fade', durationUs: 500_000 } })
    )
    expect(withTransition.video[0].leadInFrames).toBe(15)
    expect(buildRenderPlan(project({})).video[0].leadInFrames).toBe(0)
  })

  it('chuyển cảnh RA không đẩy mốc, vì Sequence không bắt đầu sớm hơn', () => {
    const plan = buildRenderPlan(
      project({
        keyframes: opacityTrack,
        transitionOut: { kind: 'fade', durationUs: 500_000 }
      })
    )
    expect(plan.video[0].keyframes?.['transform.opacity'][0].f).toBe(30)
  })
})

describe('giá trị transform tại một khung', () => {
  const tracks: ResolvedKeyframeTracks = {
    'transform.scale': [
      { f: 0, v: 1, e: 'linear' },
      { f: 60, v: 2, e: 'linear' }
    ]
  }

  it('không có keyframe thì trả về CHÍNH object tĩnh', () => {
    // Cùng tham chiếu, không phải chỉ bằng nhau: đây là đường chạy của mọi clip
    // trong mọi dự án chưa dùng tính năng này, mỗi khung hình, mỗi clip.
    const statics = { ...DEFAULT_CLIP_TRANSFORM }
    expect(transformValuesAt(undefined, 10, statics)).toBe(statics)
  })

  it('chỉ thuộc tính có keyframe mới đổi, bốn cái còn lại giữ giá trị tĩnh', () => {
    const statics = { x: 0.25, y: -0.5, scale: 1, rotationDeg: 30, opacity: 0.8 }
    const at30 = transformValuesAt(tracks, 30, statics)
    expect(at30.scale).toBeCloseTo(1.5, 10)
    expect(at30.x).toBe(0.25)
    expect(at30.y).toBe(-0.5)
    expect(at30.rotationDeg).toBe(30)
    expect(at30.opacity).toBe(0.8)
  })

  it('kẹp ở hai đầu, không ngoại suy ra ngoài clip', () => {
    const statics = { ...DEFAULT_CLIP_TRANSFORM }
    expect(transformValuesAt(tracks, -10, statics).scale).toBe(1)
    expect(transformValuesAt(tracks, 999, statics).scale).toBe(2)
  })
})
