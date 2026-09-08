import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { buildRenderPlan, resolveTransitionFrames } from './remotion-render-plan'
import { DEFAULT_TRANSITION_DURATION_US, type Clip } from './timeline-track-types'

/**
 * Chuyển cảnh.
 *
 * Cách làm: clip đến BẮT ĐẦU SỚM HƠN để phủ lên clip đi, và lùi điểm vào nguồn
 * tương ứng. Nhờ vậy timeline không bị co lại như khi dùng `xfade` của ffmpeg —
 * mọi thứ phía sau giữ nguyên vị trí tuyệt đối.
 *
 * Chỗ dễ sai là KẸP GIỚI HẠN: clip không đủ phần nguồn phía trước thì chuyển cảnh
 * phải ngắn lại, chứ không được đọc trước đầu file hay kéo lùi qua mốc 0.
 */

const FPS = { num: 30, den: 1 }

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    startUs: 5_000_000,
    durationUs: 3_000_000,
    sourceInUs: 2_000_000,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    transitionIn: { kind: 'fade', durationUs: DEFAULT_TRANSITION_DURATION_US },
    ...overrides
  }
}

describe('resolveTransitionFrames — kẹp giới hạn', () => {
  it('dùng đủ thời lượng khi clip có đủ phần nguồn phía trước', () => {
    // 0,5 giây ở 30fps = 15 khung; nguồn còn 2 giây phía trước nên thoải mái.
    expect(resolveTransitionFrames(clip(), FPS)).toBe(15)
  })

  it('kẹp theo phần nguồn còn lại, không đọc trước đầu file', () => {
    // Chỉ còn 0,2 giây = 6 khung handle.
    expect(resolveTransitionFrames(clip({ sourceInUs: 200_000 }), FPS)).toBe(6)
  })

  it('không có handle nào thì không có chuyển cảnh', () => {
    expect(resolveTransitionFrames(clip({ sourceInUs: 0 }), FPS)).toBe(0)
  })

  it('kẹp theo vị trí trên timeline, không kéo lùi qua mốc 0', () => {
    // Clip bắt đầu ở 0,1 giây = 3 khung, dù nguồn còn thừa handle.
    expect(resolveTransitionFrames(clip({ startUs: 100_000 }), FPS)).toBe(3)
  })

  it('kẹp theo độ dài chính clip — chuyển cảnh dài hơn clip là vô nghĩa', () => {
    expect(resolveTransitionFrames(clip({ durationUs: 200_000 }), FPS)).toBe(6)
  })

  it('tốc độ phát nhanh tiêu thụ nguồn nhanh hơn nên handle ngắn lại', () => {
    // Chạy 2x: 2 giây nguồn chỉ đủ cho 1 giây timeline, nhưng 0,5s vẫn vừa.
    expect(resolveTransitionFrames(clip({ speed: 2 }), FPS)).toBe(15)
    // Còn 0,2 giây nguồn ở tốc độ 2x thì chỉ đủ 3 khung.
    expect(resolveTransitionFrames(clip({ sourceInUs: 200_000, speed: 2 }), FPS)).toBe(3)
  })

  it('không có chuyển cảnh thì trả về 0', () => {
    expect(resolveTransitionFrames(clip({ transitionIn: undefined }), FPS)).toBe(0)
  })
})

function projectWithTwoClips(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'a.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })

  const trackId = document.tracks.find((track) => track.kind === 'video')!.id
  for (const [index, start] of [0, 3_000_000].entries()) {
    const result = applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: `clip_${index + 1}`,
      trackId,
      assetId: 'asset_1',
      startUs: start,
      durationUs: 3_000_000,
      sourceInUs: index * 5_000_000
    })
    if (!result.ok) throw new Error(result.error)
  }
  return document
}

describe('kế hoạch render với chuyển cảnh', () => {
  it('clip đến bắt đầu sớm hơn để phủ lên clip đi', () => {
    const document = projectWithTwoClips()
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_2',
      transition: { kind: 'fade', durationUs: 500_000 }
    })

    const plan = buildRenderPlan(document)
    const second = plan.video.find((item) => item.key === 'clip_2')!
    // Đáng lẽ bắt đầu ở khung 90 (giây 3), giờ lùi 15 khung để chồng lên clip đầu.
    expect(second.fromFrame).toBe(75)
    expect(second.fromFrame + second.durationInFrames).toBe(180)
  })

  it('lùi điểm vào nguồn tương ứng để nội dung không nhảy', () => {
    const document = projectWithTwoClips()
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_2',
      transition: { kind: 'fade', durationUs: 500_000 }
    })

    const second = buildRenderPlan(document).video.find((item) => item.key === 'clip_2')!
    // Nguồn vào ở giây 5 = khung 150, lùi 15 khung theo phần chồng.
    expect(second.sourceFromFrame).toBe(135)
  })

  it('KHÔNG làm co timeline — clip phía sau giữ nguyên vị trí', () => {
    const document = projectWithTwoClips()
    const before = buildRenderPlan(document).durationInFrames

    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_2',
      transition: { kind: 'fade', durationUs: 500_000 }
    })

    // Đây là khác biệt cốt lõi so với `xfade`: tổng thời lượng không đổi.
    expect(buildRenderPlan(document).durationInFrames).toBe(before)
  })

  it('clip đến vẽ SAU clip đi để phủ lên trên', () => {
    const document = projectWithTwoClips()
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_2',
      transition: { kind: 'wipe-left', durationUs: 500_000 }
    })

    const plan = buildRenderPlan(document)
    expect(plan.video.map((item) => item.key)).toEqual(['clip_1', 'clip_2'])
    expect(plan.video[1].transition).toEqual({ kind: 'wipe-left', frames: 15 })
  })

  it('clip đầu timeline không có chuyển cảnh dù đã đặt', () => {
    const document = projectWithTwoClips()
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_1',
      transition: { kind: 'fade', durationUs: 500_000 }
    })

    // Nằm ở mốc 0 và không có nguồn phía trước — không kéo lùi được.
    const first = buildRenderPlan(document).video.find((item) => item.key === 'clip_1')!
    expect(first.transition).toBeUndefined()
    expect(first.fromFrame).toBe(0)
  })
})

describe('lệnh đặt chuyển cảnh', () => {
  it('gỡ được chuyển cảnh bằng cách bỏ trống', () => {
    const document = projectWithTwoClips()
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_2',
      transition: { kind: 'zoom', durationUs: 500_000 }
    })
    applyEditorCommand(document, { type: 'clip/set-transition', clipId: 'clip_2' })

    const track = document.tracks.find((item) => item.kind === 'video')!
    expect(track.clips[1].transitionIn).toBeUndefined()
  })

  it('từ chối đặt lên clip tiếng', () => {
    const document = projectWithTwoClips()
    const audioTrack = document.tracks.find((track) => track.kind === 'audio')!
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: 'clip_audio',
      trackId: audioTrack.id,
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 1_000_000,
      sourceInUs: 0
    })

    const result = applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_audio',
      transition: { kind: 'fade', durationUs: 500_000 }
    })
    expect(result.ok).toBe(false)
  })

  it('từ chối clip không tồn tại', () => {
    const document = projectWithTwoClips()
    const result = applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'khong_co',
      transition: { kind: 'fade', durationUs: 500_000 }
    })
    expect(result.ok).toBe(false)
  })
})
