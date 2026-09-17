import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { DEFAULT_SUBTITLE_STYLE } from './subtitle-types'
import type { Clip } from './timeline-track-types'
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

describe('look màu và hiệu ứng ra cũng buộc dựng bằng Remotion', () => {
  function projectWithClip(extra: Partial<Clip>): ProjectDocument {
    const document = createEmptyProject({ name: 'Look' })
    document.tracks
      .find((item) => item.kind === 'video')!
      .clips.push({
        id: 'clip_1',
        assetId: 'asset_1',
        startUs: 0,
        durationUs: 3_000_000,
        sourceInUs: 0,
        speed: 1,
        volume: 1,
        fadeInUs: 0,
        fadeOutUs: 0,
        ...extra
      })
    return document
  }

  it('clip có look màu thì không xuất bằng ffmpeg được', () => {
    // Đo được trên bản xuất thật: ffmpeg cho ra đúng màu gốc, look biến mất
    // mà không báo gì, trong khi preview vẫn hiện look.
    expect(requiresRemotionRenderer(projectWithClip({}))).toBe(false)
    expect(
      requiresRemotionRenderer(projectWithClip({ look: { id: 'mono-film', intensity: 1 } }))
    ).toBe(true)
  })

  it('clip chỉ có hiệu ứng ra cũng không xuất bằng ffmpeg được', () => {
    expect(
      requiresRemotionRenderer(
        projectWithClip({ transitionOut: { kind: 'fade', durationUs: 500_000 } })
      )
    ).toBe(true)
  })
})

describe('lane chữ', () => {
  /** Thêm một lane chữ và trả về id của nó. */
  function addTextLane(document: ProjectDocument, name: string): string {
    const before = new Set(document.tracks.map((track) => track.id))
    expect(applyEditorCommand(document, { type: 'track/add', kind: 'text', name }, makeId).ok).toBe(
      true
    )
    const added = document.tracks.find((track) => !before.has(track.id))
    return added!.id
  }

  function addOverlay(document: ProjectDocument, id: string, trackId?: string): void {
    document.textOverlays.push({
      id,
      trackId,
      text: id,
      startUs: 0,
      endUs: 1_000_000,
      style: { ...DEFAULT_SUBTITLE_STYLE },
      animation: 'none',
      animationDurationUs: 0
    })
  }

  it('ẩn lane chữ thì chữ trên nó biến mất khỏi bản dựng', () => {
    const document = project()
    const laneId = addTextLane(document, 'Text 1')
    addOverlay(document, 'text_1', laneId)
    addOverlay(document, 'text_2')

    expect(buildRenderPlan(document).textOverlays.map((item) => item.key)).toEqual([
      'text_1',
      'text_2'
    ])

    applyEditorCommand(document, {
      type: 'track/update',
      trackId: laneId,
      patch: { hidden: true }
    })
    // Chỉ chữ trên lane bị ẩn mất đi; chữ chưa thuộc lane nào vẫn còn.
    expect(buildRenderPlan(document).textOverlays.map((item) => item.key)).toEqual(['text_2'])
  })

  it('lane dưới vẽ sau, tức nằm trên; chữ chưa thuộc lane nào vẫn trên cùng', () => {
    const document = project()
    const first = addTextLane(document, 'Text 1')
    const second = addTextLane(document, 'Text 2')

    // Thêm ngược thứ tự lane, để phép thử đo đúng việc sắp xếp chứ không đo
    // trùng hợp với thứ tự trong tài liệu.
    addOverlay(document, 'tren-cung')
    addOverlay(document, 'lane-2', second)
    addOverlay(document, 'lane-1', first)

    expect(buildRenderPlan(document).textOverlays.map((item) => item.key)).toEqual([
      'lane-1',
      'lane-2',
      'tren-cung'
    ])
  })

  it('cùng một lane thì giữ nguyên thứ tự trong tài liệu', () => {
    const document = project()
    const laneId = addTextLane(document, 'Text 1')
    addOverlay(document, 'a', laneId)
    addOverlay(document, 'b', laneId)

    expect(buildRenderPlan(document).textOverlays.map((item) => item.key)).toEqual(['a', 'b'])
  })

  it('xoá lane chữ thì xoá luôn chữ thuộc lane đó, chừa chữ của lane khác', () => {
    const document = project()
    const first = addTextLane(document, 'Text 1')
    const second = addTextLane(document, 'Text 2')
    addOverlay(document, 'cua-lane-1', first)
    addOverlay(document, 'cua-lane-2', second)
    addOverlay(document, 'khong-lane')

    expect(applyEditorCommand(document, { type: 'track/remove', trackId: first }).ok).toBe(true)

    // Còn sót lại thì chữ vẫn vẽ lên hình mà không còn chỗ nào bấm vào để sửa.
    expect(document.textOverlays.map((item) => item.id)).toEqual(['cua-lane-2', 'khong-lane'])
  })

  it('chữ trỏ vào lane đã xoá vẫn được dựng, không biến mất theo', () => {
    const document = project()
    const laneId = addTextLane(document, 'Text 1')
    addOverlay(document, 'mo-coi', 'lane_khong_ton_tai')
    addOverlay(document, 'cua-lane', laneId)
    applyEditorCommand(document, { type: 'track/remove', trackId: laneId })

    // `mo-coi` không thuộc lane nào còn sống nên rơi về lane ảo — vẫn thấy được.
    expect(buildRenderPlan(document).textOverlays.map((item) => item.key)).toEqual(['mo-coi'])
  })
})

describe('lane ảnh', () => {
  function addImageLane(document: ProjectDocument, name = 'Hình ảnh 1'): string {
    const before = new Set(document.tracks.map((track) => track.id))
    expect(
      applyEditorCommand(document, { type: 'track/add', kind: 'image', name }, makeId).ok
    ).toBe(true)
    return document.tracks.find((track) => !before.has(track.id))!.id
  }

  it('clip trên lane ảnh được đánh dấu là ảnh, không phải video', () => {
    const document = project()
    const laneId = addImageLane(document)
    addClip(document, laneId, 0, 3_000_000)

    const [clip] = buildRenderPlan(document).video
    // Lớp vẽ dựa vào đúng cờ này để chọn thẻ; sai cờ là một ô trống, không lỗi.
    expect(clip.media).toBe('image')
  })

  it('clip trên lane hình vẫn là video', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 3_000_000)
    expect(buildRenderPlan(document).video[0].media).toBe('video')
  })

  it('ảnh luôn câm, kể cả khi track không bị tắt tiếng', () => {
    const document = project()
    const laneId = addImageLane(document)
    addClip(document, laneId, 0, 3_000_000)
    expect(buildRenderPlan(document).video[0].muted).toBe(true)
  })

  it('ảnh đọc từ khung 0 dù clip có điểm vào nguồn', () => {
    const document = project()
    const laneId = addImageLane(document)
    addClip(document, laneId, 0, 3_000_000, 2_000_000)
    // Ảnh không có trục thời gian nguồn; đọc theo `sourceInUs` là vô nghĩa.
    expect(buildRenderPlan(document).video[0].sourceFromFrame).toBe(0)
  })

  it('chuyển cảnh trên ảnh KHÔNG bị kẹp về 0 vì thiếu phần nguồn phía trước', () => {
    const document = project()
    const laneId = addImageLane(document)
    addClip(document, laneId, 2_000_000, 3_000_000)
    const clipId = document.tracks.find((track) => track.id === laneId)!.clips[0].id
    expect(
      applyEditorCommand(document, {
        type: 'clip/set-transition',
        clipId,
        transition: { kind: 'fade', durationUs: 500_000 }
      }).ok
    ).toBe(true)

    // Một tấm ảnh đứng yên nên lấy bao nhiêu khung phía trước cũng được. Kẹp về 0
    // thì chuyển cảnh lặng lẽ mất tác dụng trên mọi ảnh.
    expect(buildRenderPlan(document).video[0].transition?.frames).toBeGreaterThan(0)
  })

  it('lane ảnh ẩn thì ảnh biến mất khỏi bản dựng', () => {
    const document = project()
    const laneId = addImageLane(document)
    addClip(document, laneId, 0, 3_000_000)
    applyEditorCommand(document, { type: 'track/update', trackId: laneId, patch: { hidden: true } })
    expect(buildRenderPlan(document).video).toHaveLength(0)
  })

  it('lane ảnh nằm dưới thì vẽ ĐÈ lên lane hình', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 3_000_000)
    const laneId = addImageLane(document)
    addClip(document, laneId, 0, 3_000_000)

    const plan = buildRenderPlan(document)
    const videoLayer = plan.video.find((clip) => clip.media === 'video')!.layerIndex
    const imageLayer = plan.video.find((clip) => clip.media === 'image')!.layerIndex
    expect(imageLayer).toBeGreaterThan(videoLayer)
    // Danh sách đã sắp theo lớp, nên lớp vẽ cứ theo thứ tự mà vẽ.
    expect(plan.video.map((clip) => clip.media)).toEqual(['video', 'image'])
  })

  it('dự án có ảnh buộc phải dựng bằng Remotion', () => {
    const document = project()
    expect(requiresRemotionRenderer(document)).toBe(false)
    const laneId = addImageLane(document)
    // Lane rỗng thì chưa cần: chưa có gì để vẽ.
    expect(requiresRemotionRenderer(document)).toBe(false)

    addClip(document, laneId, 0, 3_000_000)
    // Filter graph ffmpeg đọc file theo trục thời gian của video; ảnh không có
    // trục đó, nên xuất bằng ffmpeg sẽ ra file thiếu ảnh mà không báo gì.
    expect(requiresRemotionRenderer(document)).toBe(true)
  })
})

describe('hiệu ứng ra của clip', () => {
  it('kẹp theo NỬA clip, không theo phần nguồn phía trước', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 2_000_000)
    const clipId = document.tracks[0].clips[0].id
    expect(
      applyEditorCommand(document, {
        type: 'clip/set-transition',
        clipId,
        edge: 'out',
        transition: { kind: 'fade', durationUs: 5_000_000 }
      }).ok
    ).toBe(true)

    // Clip 2 giây ở 30fps là 60 khung; hiệu ứng ra nhiều nhất 30 khung. Chiếm
    // trọn thì clip không bao giờ đứng yên ở trạng thái nhìn được.
    expect(buildRenderPlan(document).video[0].exitTransition).toEqual({ kind: 'fade', frames: 30 })
  })

  it('KHÔNG bị kẹp bởi `sourceInUs` như hiệu ứng vào', () => {
    const document = project()
    // Clip bắt đầu ở 0 và điểm vào nguồn cũng 0: hiệu ứng VÀO sẽ bị kẹp về 0.
    addClip(document, videoTrack(document), 0, 4_000_000, 0)
    const clipId = document.tracks[0].clips[0].id
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId,
      transition: { kind: 'fade', durationUs: 500_000 }
    })
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId,
      edge: 'out',
      transition: { kind: 'fade', durationUs: 500_000 }
    })

    const [clip] = buildRenderPlan(document).video
    // Hiệu ứng ra không kéo clip bắt đầu sớm hơn nên chẳng tiêu thụ nguồn nào.
    expect(clip.transition).toBeUndefined()
    expect(clip.exitTransition?.frames).toBe(15)
  })

  it('đặt mép ra không đụng tới mép vào', () => {
    const document = project()
    addClip(document, videoTrack(document), 2_000_000, 4_000_000, 3_000_000)
    const clipId = document.tracks[0].clips[0].id
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId,
      transition: { kind: 'zoom', durationUs: 300_000 }
    })
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId,
      edge: 'out',
      transition: { kind: 'blur', durationUs: 300_000 }
    })

    const [clip] = buildRenderPlan(document).video
    expect(clip.transition?.kind).toBe('zoom')
    expect(clip.exitTransition?.kind).toBe('blur')
  })

  it('gỡ hiệu ứng ra thì kế hoạch không còn nó', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 4_000_000)
    const clipId = document.tracks[0].clips[0].id
    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId,
      edge: 'out',
      transition: { kind: 'fade', durationUs: 500_000 }
    })
    applyEditorCommand(document, { type: 'clip/set-transition', clipId, edge: 'out' })
    expect(buildRenderPlan(document).video[0].exitTransition).toBeUndefined()
  })
})

describe('kích thước gốc của ảnh', () => {
  it('kế hoạch mang theo kích thước gốc để lớp vẽ đặt ảnh đúng chỗ nó chiếm', () => {
    const document = project()
    document.assets.push({
      ...document.assets[0],
      id: 'asset_anh',
      kind: 'image',
      name: 'logo.png',
      probe: { durationUs: 0, hasVideo: true, hasAudio: false, width: 800, height: 600 }
    })
    const before = new Set(document.tracks.map((track) => track.id))
    applyEditorCommand(document, { type: 'track/add', kind: 'image', name: 'Hình ảnh 1' }, makeId)
    const laneId = document.tracks.find((track) => !before.has(track.id))!.id
    expect(
      applyEditorCommand(
        document,
        {
          type: 'clip/insert',
          trackId: laneId,
          assetId: 'asset_anh',
          startUs: 0,
          durationUs: 3_000_000,
          sourceInUs: 0
        },
        makeId
      ).ok
    ).toBe(true)

    expect(buildRenderPlan(document).video[0].natural).toEqual({ width: 800, height: 600 })
  })
})

describe('thứ tự lớp chung cho mọi loại lane', () => {
  /** Thêm một lane và trả về id. */
  function addLane(
    document: ProjectDocument,
    kind: 'video' | 'image' | 'text',
    name: string
  ): string {
    const before = new Set(document.tracks.map((track) => track.id))
    expect(applyEditorCommand(document, { type: 'track/add', kind, name }, makeId).ok).toBe(true)
    return document.tracks.find((track) => !before.has(track.id))!.id
  }

  function addOverlay(document: ProjectDocument, id: string, trackId?: string): void {
    document.textOverlays.push({
      id,
      trackId,
      text: id,
      startUs: 0,
      endUs: 1_000_000,
      style: { ...DEFAULT_SUBTITLE_STYLE },
      animation: 'none',
      animationDurationUs: 0
    })
  }

  it('lane chữ đặt TRÊN lane hình thì chữ nằm DƯỚI hình', () => {
    const document = project()
    // Lane chữ chèn vào đầu danh sách, trên cả track hình mặc định.
    const before = new Set(document.tracks.map((track) => track.id))
    applyEditorCommand(
      document,
      { type: 'track/add', kind: 'text', name: 'Text 1', index: 0 },
      makeId
    )
    const textLane = document.tracks.find((track) => !before.has(track.id))!.id
    addOverlay(document, 'chu', textLane)
    addClip(document, videoTrack(document), 0, 1_000_000)

    const plan = buildRenderPlan(document)
    // Lớp nhỏ hơn vẽ trước, tức nằm dưới. Trước đây chữ luôn nằm trên bất kể
    // xếp lane thế nào, nên kéo lane cũng không đổi được gì.
    expect(plan.textOverlays[0].layerIndex).toBeLessThan(plan.video[0].layerIndex)
  })

  it('lane chữ đặt DƯỚI lane hình thì chữ nằm TRÊN hình', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1_000_000)
    const textLane = addLane(document, 'text', 'Text 1')
    addOverlay(document, 'chu', textLane)

    const plan = buildRenderPlan(document)
    expect(plan.textOverlays[0].layerIndex).toBeGreaterThan(plan.video[0].layerIndex)
  })

  it('cue phụ đề cũng lấy lớp theo lane của nó', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1_000_000)
    document.subtitleTracks.push({
      id: 'sub_1',
      name: 'Tiếng Việt',
      language: 'vi',
      source: { kind: 'manual' },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [{ id: 'cue_1', startUs: 0, endUs: 1_000_000, text: 'Xin chào', edited: false }]
    })
    const before = new Set(document.tracks.map((track) => track.id))
    applyEditorCommand(
      document,
      { type: 'track/add', kind: 'subtitle', name: 'Phụ đề', subtitleTrackId: 'sub_1' },
      makeId
    )
    const laneIndex = document.tracks.findIndex((track) => !before.has(track.id))

    expect(buildRenderPlan(document).subtitles[0].layerIndex).toBe(laneIndex)
  })

  it('chữ chưa thuộc lane nào nằm TRÊN CÙNG', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1_000_000)
    const textLane = addLane(document, 'text', 'Text 1')
    addOverlay(document, 'tren-cung')
    addOverlay(document, 'trong-lane', textLane)

    const plan = buildRenderPlan(document)
    const loose = plan.textOverlays.find((item) => item.key === 'tren-cung')!
    const inLane = plan.textOverlays.find((item) => item.key === 'trong-lane')!
    expect(loose.layerIndex).toBeGreaterThan(inLane.layerIndex)
  })

  it('lane ảnh dưới lane hình thì ảnh đè lên hình', () => {
    const document = project()
    addClip(document, videoTrack(document), 0, 1_000_000)
    const imageLane = addLane(document, 'image', 'Hình ảnh 1')
    addClip(document, imageLane, 0, 1_000_000)

    const plan = buildRenderPlan(document)
    expect(plan.video.map((clip) => clip.media)).toEqual(['video', 'image'])
  })
})
