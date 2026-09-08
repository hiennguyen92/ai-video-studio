import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { clipEndUs } from '../domain/timeline-track-types'
import { planChatToolCalls, secondsToMicros, type ChatEditContext } from './chat-tool-planner'

/**
 * Đây là phép thử cho RANH GIỚI AN TOÀN của AI Chat.
 *
 * Điều cần chứng minh không phải "công cụ chạy được", mà là **đầu ra bịa đặt của
 * mô hình không đi tới được tài liệu project**: tên công cụ lạ, id không tồn tại,
 * tham số sai kiểu, số vô nghĩa — tất cả phải bị chặn và ghi lý do, chứ không
 * được lọt thành một lệnh sửa nào.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'audio',
    name: 'a.wav',
    source: { path: '/tmp/a.wav', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  return document
}

function withClip(): { document: ProjectDocument; clipId: string; trackId: string } {
  const document = project()
  const trackId = document.tracks[0].id
  const clipId = 'clip_a'
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId,
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0
  })
  if (!result.ok) throw new Error(result.error)
  return { document, clipId, trackId }
}

function context(document: ProjectDocument, selectedClipIds: string[] = []): ChatEditContext {
  return { document, selectedClipIds, playheadUs: 0, makeId }
}

describe('chặn đầu ra không hợp lệ của mô hình', () => {
  it('từ chối công cụ không có trong danh mục', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'delete_everything', arguments: {} }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures[0]).toEqual({
      tool: 'delete_everything',
      reason: 'Công cụ không tồn tại'
    })
  })

  it('từ chối id clip mô hình bịa ra', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId: 'clip_khong_co', atSeconds: 2 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures[0].reason).toContain('Không tìm thấy clip')
  })

  it('từ chối tham số sai kiểu', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 'hai giây' } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('từ chối số vô nghĩa như NaN và Infinity', () => {
    const { document, clipId } = withClip()
    for (const atSeconds of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const plan = planChatToolCalls(context(document), [
        { name: 'split_clip', arguments: { clipId, atSeconds } }
      ])
      expect(plan.steps).toEqual([])
    }
  })

  it('từ chối âm lượng ngoài khoảng cho phép', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_clip_volume', arguments: { clipId, volume: 99 } }
    ])
    expect(plan.steps).toEqual([])
  })

  it('một bước hỏng không kéo đổ những bước còn lại', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 3 } },
      { name: 'khong_ton_tai', arguments: {} },
      { name: 'set_clip_volume', arguments: { clipId, volume: 0.5 } }
    ])

    expect(plan.steps).toHaveLength(2)
    expect(plan.failures).toHaveLength(1)
  })

  it('không cắt được ở vị trí nằm ngoài clip', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 99 } }
    ])
    expect(plan.failures[0].reason).toContain('nằm ngoài clip')
  })
})

describe('giải nghĩa "clip đang chọn"', () => {
  it('dùng clip đang chọn khi mô hình không nêu id', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document, [clipId]), [
      { name: 'split_clip', arguments: { atSeconds: 5 } }
    ])

    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].commands[0]).toMatchObject({ type: 'clip/split', clipId })
  })

  it('báo rõ khi chưa chọn clip nào', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { atSeconds: 5 } }
    ])
    expect(plan.failures[0].reason).toContain('Chưa chọn clip')
  })

  it('không đoán bừa khi đang chọn nhiều clip', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document, [clipId, 'clip_b']), [
      { name: 'remove_clip', arguments: {} }
    ])
    expect(plan.failures[0].reason).toContain('nhiều clip')
  })
})

describe('quy đổi giây sang micro giây', () => {
  it('làm tròn nửa lên, đúng quy ước của dự án', () => {
    expect(secondsToMicros(1.5)).toBe(1_500_000)
    expect(secondsToMicros(0.0000005)).toBe(1)
  })

  it('lệnh sinh ra mang micro giây nguyên, không phải số thập phân', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 3.3333333 } }
    ])
    const command = plan.steps[0].commands[0] as { atUs: number }
    expect(Number.isInteger(command.atUs)).toBe(true)
  })
})

describe('lệnh dựng ra chạy được qua reducer thật', () => {
  it('cắt clip đúng vị trí', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 4 } }
    ])

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clips = document.tracks[0].clips
    expect(clips).toHaveLength(2)
    expect(clipEndUs(clips[0])).toBe(4_000_000)
  })

  it('đổi tên dự án', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'rename_project', arguments: { name: 'Tên mới' } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      applyEditorCommand(document, command)
    }
    expect(document.name).toBe('Tên mới')
  })

  it('nhiều bước gộp lại vẫn áp dụng được theo thứ tự', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'split_clip', arguments: { clipId, atSeconds: 4 } },
      { name: 'set_clip_volume', arguments: { clipId, volume: 0.5 } }
    ])

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[0].clips[0].volume).toBe(0.5)
  })
})

describe('công cụ tạo phụ đề', () => {
  it('báo rõ khi chưa có bản phiên âm', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'create_subtitle_track', arguments: {} }
    ])
    expect(plan.failures[0].reason).toContain('chưa có bản phiên âm')
  })

  it('tạo được track phụ đề kèm lane trên timeline', () => {
    const { document, clipId } = withClip()
    document.transcripts.push({
      id: 'tr_1',
      assetId: 'asset_1',
      language: 'en',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: '2026-01-01T00:00:00.000Z',
      segments: [{ id: 's1', startUs: 1_000_000, endUs: 2_000_000, text: 'Hi', edited: false }]
    })
    expect(clipId).toBe('clip_a')

    const plan = planChatToolCalls(context(document), [
      { name: 'create_subtitle_track', arguments: {} }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.subtitleTracks).toHaveLength(1)
    // Không có lane trỏ tới thì phụ đề dựng ra cũng không hiện ở đâu cả.
    const lane = document.tracks.find((track) => track.kind === 'subtitle')
    expect(lane?.subtitleTrackId).toBe(document.subtitleTracks[0].id)
  })
})

describe('công cụ giảm nhạc', () => {
  it('báo rõ khi không có đoạn nhạc nào trùng lời nói', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [{ name: 'auto_duck_music', arguments: {} }])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ đổi khung hình', () => {
  it('9:16 ra khung dọc, đúng thứ TikTok cần', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_canvas', arguments: { aspect: '9:16' } }
    ])

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.settings.width).toBe(1080)
    expect(document.settings.height).toBe(1920)
    expect(document.settings.aspectRatio).toBe('9:16')
  })

  it('luôn ra cạnh chẵn — cạnh lẻ thì h264 không mã hoá được', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_canvas', arguments: { aspect: '9:16', longEdgePx: 1001 } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.settings.width % 2).toBe(0)
    expect(document.settings.height % 2).toBe(0)
  })

  it('từ chối tỉ lệ không có trong danh sách', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_canvas', arguments: { aspect: '4:3' } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ chuyển cảnh', () => {
  it('đặt được chuyển cảnh vào đầu clip', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      {
        name: 'set_clip_transition',
        arguments: { clipId, kind: 'wipe-left', durationSeconds: 0.4 }
      }
    ])

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clip = document.tracks[0].clips.find((item) => item.id === clipId)
    expect(clip?.transitionIn).toEqual({ kind: 'wipe-left', durationUs: 400_000 })
  })

  it('"none" gỡ chuyển cảnh đã đặt', () => {
    const { document, clipId } = withClip()
    const calls = [
      { name: 'set_clip_transition', arguments: { clipId, kind: 'fade' } },
      { name: 'set_clip_transition', arguments: { clipId, kind: 'none' } }
    ]

    for (const call of calls) {
      const plan = planChatToolCalls(context(document), [call])
      expect(plan.failures).toEqual([])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    const clip = document.tracks[0].clips.find((item) => item.id === clipId)
    expect(clip?.transitionIn).toBeUndefined()
  })

  it('từ chối kiểu chuyển cảnh mô hình bịa ra', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_clip_transition', arguments: { clipId, kind: 'star-wipe' } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('id sinh ra mang đúng tiền tố', () => {
  it('chữ overlay không mang id kiểu clip — agent sẽ gọi nhầm công cụ', () => {
    const document = project()
    const plan = planChatToolCalls(
      { document, selectedClipIds: [], playheadUs: 0, makeId: (prefix) => `${prefix ?? 'clip'}_x` },
      [{ name: 'add_text_overlay', arguments: { text: 'Hook', startSeconds: 0, endSeconds: 2 } }]
    )

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.textOverlays[0].id).toBe('text_x')
  })

  it('track thêm mới mang id kiểu track', () => {
    const document = project()
    const plan = planChatToolCalls(
      { document, selectedClipIds: [], playheadUs: 0, makeId: (prefix) => `${prefix ?? 'clip'}_x` },
      [{ name: 'add_track', arguments: { kind: 'audio', name: 'Nhạc' } }]
    )

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.tracks.at(-1)?.id).toBe('track_x')
  })
})

describe('nền hộp cho chữ overlay', () => {
  const boxOf = (args: Record<string, unknown>): ReturnType<typeof project>['textOverlays'][0] => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'add_text_overlay', arguments: { startSeconds: 0, endSeconds: 2, ...args } }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    return document.textOverlays[0]
  }

  it('không nêu thì không có hộp, và chữ vẫn còn viền', () => {
    const overlay = boxOf({ text: 'Hook' })
    expect(overlay.style.boxOpacity).toBe(0)
    expect(overlay.style.outlineWidthPx).toBeGreaterThan(0)
  })

  it('hộp tối: nền đen mờ, chữ trắng', () => {
    const overlay = boxOf({ text: 'Hook', box: 'dark' })
    expect(overlay.style.boxOpacity).toBeGreaterThan(0)
    expect(overlay.style.boxColor).toBe('#000000')
    expect(overlay.style.color).toBe('#FFFFFF')
  })

  it('hộp sáng phải đổi chữ sang màu tối — trắng trên trắng là mất chữ', () => {
    const overlay = boxOf({ text: 'Hook', box: 'light' })
    expect(overlay.style.boxColor).toBe('#FFFFFF')
    expect(overlay.style.color).not.toBe('#FFFFFF')
  })

  it('từ chối kiểu hộp không có trong danh sách', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      {
        name: 'add_text_overlay',
        arguments: { text: 'Hook', startSeconds: 0, endSeconds: 2, box: 'gradient' }
      }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})
