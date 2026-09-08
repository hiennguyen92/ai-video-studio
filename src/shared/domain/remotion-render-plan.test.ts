import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { DEFAULT_SUBTITLE_STYLE } from './subtitle-types'
import { buildRenderPlan, requiresRemotionRenderer } from './remotion-render-plan'

/**
 * Quy đổi micro giây sang khung hình cho Remotion.
 *
 * Lệch một khung ở đây thì hình và tiếng lệch nhau cả bản dựng mà không có lỗi
 * nào báo ra — nên mọi ca đều kiểm bằng con số cụ thể, không kiểm "có chạy không".
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'canh-quay.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  return document
}

function addClip(
  document: ProjectDocument,
  trackId: string,
  startUs: number,
  durationUs: number,
  sourceInUs = 0
): string {
  const clipId = makeId()
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId,
    assetId: 'asset_1',
    startUs,
    durationUs,
    sourceInUs
  })
  if (!result.ok) throw new Error(result.error)
  return clipId
}

const videoTrack = (document: ProjectDocument): string =>
  document.tracks.find((track) => track.kind === 'video')!.id
const musicTrack = (document: ProjectDocument): string =>
  document.tracks.find((track) => track.role === 'music')!.id

describe('quy đổi thời gian', () => {
  it('đổi micro giây sang khung theo nhịp hình của dự án', () => {
    const document = project()
    // Mặc định 30fps: giây thứ 2 là khung 60, dài 3 giây là 90 khung.
    addClip(document, videoTrack(document), 2_000_000, 3_000_000)

    const plan = buildRenderPlan(document)
    expect(plan.video[0].fromFrame).toBe(60)
    expect(plan.video[0].durationInFrames).toBe(90)
  })

  it('tính thời lượng bằng hiệu hai mốc, không làm tròn riêng lẻ rồi cộng', () => {
    const document = project()
    // Mốc lẻ: 1/3 giây không rơi đúng khung nào ở 30fps.
    addClip(document, videoTrack(document), 333_333, 333_333)

    const plan = buildRenderPlan(document)
    const clip = plan.video[0]
    // Khung cuối phải khớp mốc kết thúc thật, không bị trôi.
    expect(clip.fromFrame + clip.durationInFrames).toBe(20)
  })

  it('đổi điểm vào nguồn sang khung', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1_000_000, 5_000_000)
    expect(buildRenderPlan(document).video[0].sourceFromFrame).toBe(150)
  })

  it('bỏ clip ngắn hơn một khung thay vì tạo Sequence dài 0', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1000)
    expect(buildRenderPlan(document).video).toHaveLength(0)
  })

  it('luôn có ít nhất một khung dù dự án rỗng', () => {
    expect(buildRenderPlan(project()).durationInFrames).toBe(1)
  })

  it('theo đúng nhịp hình đã đặt, không mặc định 30', () => {
    const document = project()
    document.settings.frameRate = { num: 60, den: 1 }
    addClip(document, videoTrack(document), 1_000_000, 1_000_000)

    const plan = buildRenderPlan(document)
    expect(plan.video[0].fromFrame).toBe(60)
    expect(plan.video[0].durationInFrames).toBe(60)
  })
})

describe('âm lượng và trạng thái track', () => {
  it('nhân âm lượng clip với âm lượng track', () => {
    const document = project()
    const trackId = musicTrack(document)
    addClip(document, trackId, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId, patch: { volume: 0.5 } })
    const clipId = document.tracks.find((track) => track.id === trackId)!.clips[0].id
    applyEditorCommand(document, { type: 'clip/update', clipId, patch: { volume: 0.4 } })

    expect(buildRenderPlan(document).audio[0].volume).toBeCloseTo(0.2, 5)
  })

  it('bỏ hẳn track audio đang tắt tiếng', () => {
    const document = project()
    const trackId = musicTrack(document)
    addClip(document, trackId, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId, patch: { muted: true } })

    expect(buildRenderPlan(document).audio).toHaveLength(0)
  })

  it('có track solo thì các track audio khác im', () => {
    const document = project()
    const music = musicTrack(document)
    const voice = document.tracks.find((track) => track.role === 'voiceover')!.id
    addClip(document, music, 0, 1_000_000)
    addClip(document, voice, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId: voice, patch: { solo: true } })

    const plan = buildRenderPlan(document)
    expect(plan.audio).toHaveLength(1)
  })

  it('track hình bị ẩn thì không vẽ', () => {
    const document = project()
    const trackId = videoTrack(document)
    addClip(document, trackId, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId, patch: { hidden: true } })

    expect(buildRenderPlan(document).video).toHaveLength(0)
  })

  it('track hình bị tắt tiếng vẫn HIỆN HÌNH, chỉ câm', () => {
    const document = project()
    const trackId = videoTrack(document)
    addClip(document, trackId, 0, 1_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId, patch: { muted: true } })

    const plan = buildRenderPlan(document)
    expect(plan.video).toHaveLength(1)
    expect(plan.video[0].muted).toBe(true)
  })
})

describe('phụ đề', () => {
  it('chỉ lấy cue của track phụ đề đang được lane trỏ tới', () => {
    const document = project()
    document.subtitleTracks.push({
      id: 'sub_1',
      name: 'Phụ đề',
      language: 'vi',
      source: { kind: 'manual' },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [
        { id: 'c1', startUs: 1_000_000, endUs: 2_000_000, text: 'Xin chào', edited: false },
        { id: 'c2', startUs: 3_000_000, endUs: 3_000_000, text: 'Rỗng', edited: false }
      ]
    })
    applyEditorCommand(document, {
      type: 'track/add',
      kind: 'subtitle',
      name: 'Lane',
      subtitleTrackId: 'sub_1'
    })

    const plan = buildRenderPlan(document)
    expect(plan.subtitles).toHaveLength(1)
    expect(plan.subtitles[0].fromFrame).toBe(30)
    expect(plan.subtitles[0].durationInFrames).toBe(30)
  })

  it('lane không trỏ tới đâu thì không sinh cue nào', () => {
    const document = project()
    applyEditorCommand(document, { type: 'track/add', kind: 'subtitle', name: 'Lane rỗng' })
    expect(buildRenderPlan(document).subtitles).toHaveLength(0)
  })
})

describe('thứ tự lớp', () => {
  it('track đứng sau vẽ đè lên track đứng trước', () => {
    const document = project()
    const first = videoTrack(document)
    applyEditorCommand(document, {
      type: 'track/add',
      trackId: 'video_2',
      kind: 'video',
      name: 'Video 2'
    })
    addClip(document, first, 0, 1_000_000)
    addClip(document, 'video_2', 0, 1_000_000)

    const plan = buildRenderPlan(document)
    expect(plan.video[0].layerIndex).toBeLessThan(plan.video[1].layerIndex)
  })
})

describe('thiết lập dự án', () => {
  it('lấy đúng khung hình và màu nền của dự án', () => {
    const document = project()
    document.settings.width = 1080
    document.settings.height = 1920
    document.settings.backgroundColor = '#123456'

    const plan = buildRenderPlan(document)
    expect([plan.width, plan.height]).toEqual([1080, 1920])
    expect(plan.backgroundColor).toBe('#123456')
  })
})

describe('chuyển động trong clip buộc phải dựng bằng Remotion', () => {
  it('dự án có chuyển động thì đường ffmpeg không vẽ nổi', () => {
    const document = createEmptyProject({ name: 'Chuyển động' })
    const track = document.tracks.find((item) => item.kind === 'video')!

    expect(requiresRemotionRenderer(document)).toBe(false)

    track.clips.push({
      id: 'clip_1',
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 3_000_000,
      sourceInUs: 0,
      speed: 1,
      volume: 1,
      fadeInUs: 0,
      fadeOutUs: 0,
      motion: { kind: 'zoom-in', intensity: 0.5 }
    })

    // Bỏ sót chỗ này thì xuất bằng ffmpeg cho ra file THIẾU chuyển động mà không
    // báo gì — người dùng chỉ phát hiện sau khi đã đăng video.
    expect(requiresRemotionRenderer(document)).toBe(true)
  })
})
