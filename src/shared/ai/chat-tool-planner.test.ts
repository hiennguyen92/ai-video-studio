import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { clipEndUs } from '../domain/timeline-track-types'
import { chatToolSchemas } from './chat-tool-catalog'
import { buildChatSystemPrompt } from './chat-context-builder'
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

describe('công cụ chuyển động trong clip', () => {
  it('đặt được chuyển động kèm cường độ', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_clip_motion', arguments: { clipId, kind: 'zoom-in', intensity: 0.8 } }
    ])

    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.tracks[0].clips[0].motion).toEqual({ kind: 'zoom-in', intensity: 0.8 })
  })

  it('không nêu cường độ thì dùng mức mặc định, không phải 0', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_clip_motion', arguments: { clipId, kind: 'pan-left' } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    // Cường độ 0 nghĩa là không có chuyển động nào cả — bỏ trống mà ra 0 thì công
    // cụ báo đã đặt trong khi màn hình không đổi gì.
    expect(document.tracks[0].clips[0].motion?.intensity).toBeGreaterThan(0)
  })

  it('"none" gỡ chuyển động đã đặt', () => {
    const { document, clipId } = withClip()
    for (const call of [
      { name: 'set_clip_motion', arguments: { clipId, kind: 'shake' } },
      { name: 'set_clip_motion', arguments: { clipId, kind: 'none' } }
    ]) {
      const plan = planChatToolCalls(context(document), [call])
      expect(plan.failures).toEqual([])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    expect(document.tracks[0].clips[0].motion).toBeUndefined()
  })

  it('từ chối kiểu chuyển động mô hình bịa ra và cường độ ngoài khoảng', () => {
    const { document, clipId } = withClip()

    expect(
      planChatToolCalls(context(document), [
        { name: 'set_clip_motion', arguments: { clipId, kind: 'barrel-roll' } }
      ]).failures
    ).toHaveLength(1)

    expect(
      planChatToolCalls(context(document), [
        { name: 'set_clip_motion', arguments: { clipId, kind: 'zoom-in', intensity: 5 } }
      ]).failures
    ).toHaveLength(1)
  })
})

describe('công cụ chỉnh màu clip', () => {
  it('chỉnh một thông số không xoá mất thông số đã đặt trước', () => {
    const { document, clipId } = withClip()

    for (const args of [
      { clipId, contrast: 1.3 },
      { clipId, temperature: 0.6 }
    ]) {
      const plan = planChatToolCalls(context(document), [
        { name: 'set_clip_color', arguments: args }
      ])
      expect(plan.failures).toEqual([])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    // Gọi lần hai chỉ nêu nhiệt độ; độ tương phản của lần một phải còn nguyên.
    expect(document.tracks[0].clips[0].colorGrade).toMatchObject({
      contrast: 1.3,
      temperature: 0.6
    })
  })

  it('reset đưa clip về màu gốc', () => {
    const { document, clipId } = withClip()
    for (const args of [
      { clipId, saturation: 1.8 },
      { clipId, reset: true }
    ]) {
      const plan = planChatToolCalls(context(document), [
        { name: 'set_clip_color', arguments: args }
      ])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    expect(document.tracks[0].clips[0].colorGrade).toBeUndefined()
  })

  it('gọi mà không nêu thông số nào thì báo lỗi, không im lặng bỏ qua', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_clip_color', arguments: { clipId } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('từ chối giá trị ngoài khoảng thay vì kẹp im lặng', () => {
    const { document, clipId } = withClip()
    expect(
      planChatToolCalls(context(document), [
        { name: 'set_clip_color', arguments: { clipId, brightness: 9 } }
      ]).failures
    ).toHaveLength(1)
  })
})

describe('công cụ xoá media', () => {
  it('xoá được media không ai dùng', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_media', arguments: { assetId: 'asset_1' } }
    ])

    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.assets).toHaveLength(0)
  })

  it('từ chối khi media đang được dùng, và NÓI RA số clip sẽ mất', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_media', arguments: { assetId: 'asset_1' } }
    ])

    expect(plan.steps).toEqual([])
    // Chỉ nói "đang được dùng" thì agent không biết mình sắp làm mất bao nhiêu.
    expect(plan.failures[0].reason).toContain('1 clip')
    expect(document.assets).toHaveLength(1)
  })

  it('nói rõ removeClips thì xoá cả clip lẫn media', () => {
    const { document } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_media', arguments: { assetId: 'asset_1', removeClips: true } }
    ])

    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.assets).toHaveLength(0)
    expect(document.tracks.flatMap((track) => track.clips)).toHaveLength(0)
  })

  it('media không có thật thì báo lỗi thay vì im lặng', () => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_media', arguments: { assetId: 'asset_khong_co' } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ đổi phông chữ', () => {
  const withOverlays = (): ProjectDocument => {
    const document = project()
    for (const [index, text] of ['Hook', 'CTA'].entries()) {
      const plan = planChatToolCalls(context(document), [
        {
          name: 'add_text_overlay',
          arguments: { text, startSeconds: index * 2, endSeconds: index * 2 + 1.5 }
        }
      ])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
    return document
  }

  it('không nêu chữ nào thì áp cho TẤT CẢ chữ overlay', () => {
    const document = withOverlays()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_font', arguments: { fontFamily: 'Georgia' } }
    ])

    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.textOverlays.map((item) => item.style.fontFamily)).toEqual([
      'Georgia',
      'Georgia'
    ])
  })

  it('nêu một chữ thì chỉ đổi đúng chữ đó', () => {
    const document = withOverlays()
    const target = document.textOverlays[1].id
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_font', arguments: { fontFamily: 'Georgia', overlayId: target } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.textOverlays[0].style.fontFamily).not.toBe('Georgia')
    expect(document.textOverlays[1].style.fontFamily).toBe('Georgia')
  })

  it('gắn đường dẫn file phông khi nơi gọi đã chép sẵn', () => {
    const document = withOverlays()
    const plan = planChatToolCalls(
      {
        ...context(document),
        fontFiles: { 'Georgia-Bold': '/kho/georgia-bold.ttf' }
      },
      [
        {
          name: 'set_text_font',
          arguments: { fontFamily: 'Georgia', fontPostScriptName: 'Georgia-Bold' }
        }
      ]
    )
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    // Thiếu đường dẫn này thì bản NUNG phụ đề lặng lẽ dùng phông khác preview.
    expect(document.textOverlays[0].style.fontFilePath).toBe('/kho/georgia-bold.ttf')
    expect(document.textOverlays[0].style.fontPostScriptName).toBe('Georgia-Bold')
  })

  it('dự án chưa có chữ nào thì báo lỗi, không im lặng thành công', () => {
    const plan = planChatToolCalls(context(project()), [
      { name: 'set_text_font', arguments: { fontFamily: 'Georgia' } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('track phụ đề không có thật thì báo lỗi', () => {
    const plan = planChatToolCalls(context(withOverlays()), [
      {
        name: 'set_text_font',
        arguments: { fontFamily: 'Georgia', subtitleTrackId: 'khong-co' }
      }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ xoay chữ', () => {
  const withOverlays = (): ProjectDocument => {
    const document = project()
    for (const [index, text] of ['Hook', 'CTA'].entries()) {
      const plan = planChatToolCalls(context(document), [
        {
          name: 'add_text_overlay',
          arguments: { text, startSeconds: index * 2, endSeconds: index * 2 + 1.5 }
        }
      ])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
    return document
  }

  it('không nêu chữ nào thì xoay TẤT CẢ chữ overlay', () => {
    const document = withOverlays()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_rotation', arguments: { rotationDeg: -7 } }
    ])

    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.textOverlays.map((item) => item.style.rotationDeg)).toEqual([-7, -7])
  })

  it('nêu một chữ thì chỉ xoay đúng chữ đó', () => {
    const document = withOverlays()
    const target = document.textOverlays[1].id
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_rotation', arguments: { rotationDeg: 12, overlayId: target } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.textOverlays[0].style.rotationDeg).toBeUndefined()
    expect(document.textOverlays[1].style.rotationDeg).toBe(12)
  })

  it('xoay chữ không làm mất phông đang dùng', () => {
    const document = withOverlays()
    const plans = [
      { name: 'set_text_font', arguments: { fontFamily: 'Georgia' } },
      { name: 'set_text_rotation', arguments: { rotationDeg: 9 } }
    ]
    for (const call of plans) {
      const plan = planChatToolCalls(context(document), [call])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    // Hai công cụ cùng ghi đè cả khối style; cái sau mà không đọc lại style hiện
    // tại thì nó xoá mất việc cái trước vừa làm.
    expect(document.textOverlays[0].style.fontFamily).toBe('Georgia')
    expect(document.textOverlays[0].style.rotationDeg).toBe(9)
  })

  it('xoay được cả track phụ đề', () => {
    const { document } = withClip()
    document.transcripts.push({
      id: 'tr_1',
      assetId: 'asset_1',
      language: 'vi',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: '2026-01-01T00:00:00.000Z',
      segments: [{ id: 's1', startUs: 1_000_000, endUs: 2_000_000, text: 'Hi', edited: false }]
    })
    const create = planChatToolCalls(context(document), [
      { name: 'create_subtitle_track', arguments: {} }
    ])
    for (const command of create.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const trackId = document.subtitleTracks[0].id
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_rotation', arguments: { rotationDeg: -5, subtitleTrackId: trackId } }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.subtitleTracks[0].style.rotationDeg).toBe(-5)
  })

  it('góc ngoài khoảng cho phép thì báo lỗi, không cắt bớt cho vừa', () => {
    const plan = planChatToolCalls(context(withOverlays()), [
      { name: 'set_text_rotation', arguments: { rotationDeg: 120 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('dự án chưa có chữ nào thì báo lỗi, không im lặng thành công', () => {
    const plan = planChatToolCalls(context(project()), [
      { name: 'set_text_rotation', arguments: { rotationDeg: 10 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ đặt vị trí chữ', () => {
  const withOverlays = (): ProjectDocument => {
    const document = project()
    const plan = planChatToolCalls(context(document), [
      { name: 'add_text_overlay', arguments: { text: 'Hook', startSeconds: 0, endSeconds: 2 } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    return document
  }

  it('ghim chữ vào một điểm theo tỉ lệ khung hình', () => {
    const document = withOverlays()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_text_position', arguments: { xPct: 0.5, yPct: 0.85 } }
    ])

    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.textOverlays[0].style.position).toEqual({ xPct: 0.5, yPct: 0.85 })
  })

  it('clear=true XOÁ HẲN trường vị trí, không đặt về giữa khung', () => {
    const document = withOverlays()
    for (const call of [
      { name: 'set_text_position', arguments: { xPct: 0.2, yPct: 0.2 } },
      { name: 'set_text_position', arguments: { clear: true } }
    ]) {
      const plan = planChatToolCalls(context(document), [call])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    // Còn sót trường vị trí thì alignment và lề vẫn bị bỏ qua, và người dùng
    // chỉnh lề mãi mà chữ không nhúc nhích.
    expect('position' in document.textOverlays[0].style).toBe(false)
  })

  it('thiếu một trong hai toạ độ thì báo lỗi thay vì đoán', () => {
    const plan = planChatToolCalls(context(withOverlays()), [
      { name: 'set_text_position', arguments: { xPct: 0.5 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('toạ độ ngoài khung thì báo lỗi, không kẹp cho vừa', () => {
    const plan = planChatToolCalls(context(withOverlays()), [
      { name: 'set_text_position', arguments: { xPct: 1.4, yPct: 0.5 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('ghim được cả track phụ đề', () => {
    const { document } = withClip()
    document.transcripts.push({
      id: 'tr_1',
      assetId: 'asset_1',
      language: 'vi',
      languageAutoDetected: false,
      providerId: 'whisper-cpp',
      model: 'ggml',
      createdAt: '2026-01-01T00:00:00.000Z',
      segments: [{ id: 's1', startUs: 1_000_000, endUs: 2_000_000, text: 'Hi', edited: false }]
    })
    const create = planChatToolCalls(context(document), [
      { name: 'create_subtitle_track', arguments: {} }
    ])
    for (const command of create.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const plan = planChatToolCalls(context(document), [
      {
        name: 'set_text_position',
        arguments: { xPct: 0.5, yPct: 0.1, subtitleTrackId: document.subtitleTracks[0].id }
      }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    expect(document.subtitleTracks[0].style.position).toEqual({ xPct: 0.5, yPct: 0.1 })
  })

  it('dự án chưa có chữ nào thì báo lỗi, không im lặng thành công', () => {
    const plan = planChatToolCalls(context(project()), [
      { name: 'set_text_position', arguments: { xPct: 0.5, yPct: 0.5 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('danh mục công cụ', () => {
  it('lời nhắc hệ thống liệt kê ĐỦ mọi công cụ', () => {
    // Công cụ không lọt vào lời nhắc là công cụ mô hình không biết có tồn tại —
    // có mà như không. Bảng mô tả và bảng schema là hai bảng rời, và chúng chỉ
    // khớp nhau khi còn được kiểm.
    const prompt = buildChatSystemPrompt()
    for (const name of Object.keys(chatToolSchemas)) {
      expect(prompt).toContain(name)
    }
  })
})

describe('công cụ quản lý lane', () => {
  const withTracks = (): ProjectDocument => {
    const document = project()
    for (const kind of ['text', 'image'] as const) {
      const plan = planChatToolCalls(context(document), [
        { name: 'add_track', arguments: { kind, name: `Lane ${kind}` } }
      ])
      expect(plan.failures).toEqual([])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
    return document
  }

  it('thêm được lane chữ và lane ảnh, không chỉ hình với tiếng', () => {
    const document = withTracks()
    expect(document.tracks.map((track) => track.kind)).toContain('text')
    expect(document.tracks.map((track) => track.kind)).toContain('image')
  })

  it('dời lane đổi thứ tự lớp', () => {
    const document = withTracks()
    const imageLane = document.tracks.find((track) => track.kind === 'image')!.id
    const plan = planChatToolCalls(context(document), [
      { name: 'reorder_track', arguments: { trackId: imageLane, toIndex: 0 } }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[0].id).toBe(imageLane)
  })

  it('dời tới chỗ nó đang đứng thì báo lỗi, không ghi bước rỗng', () => {
    const document = withTracks()
    const plan = planChatToolCalls(context(document), [
      { name: 'reorder_track', arguments: { trackId: document.tracks[0].id, toIndex: 0 } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('dời ra ngoài danh sách thì báo lỗi thay vì kẹp im lặng', () => {
    const document = withTracks()
    const plan = planChatToolCalls(context(document), [
      { name: 'reorder_track', arguments: { trackId: document.tracks[0].id, toIndex: 99 } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('xoá lane nói rõ sẽ mất bao nhiêu clip', () => {
    const { document, trackId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_track', arguments: { trackId } }
    ])
    expect(plan.steps[0].description).toContain('1 clip')
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks.some((track) => track.id === trackId)).toBe(false)
  })

  it('không xoá được lane đang khoá', () => {
    const { document, trackId } = withClip()
    applyEditorCommand(document, { type: 'track/update', trackId, patch: { locked: true } })
    const plan = planChatToolCalls(context(document), [
      { name: 'remove_track', arguments: { trackId } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })

  it('ẩn và khoá lane', () => {
    const { document, trackId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_track', arguments: { trackId, hidden: true, name: 'Lớp nền' } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    const track = document.tracks.find((item) => item.id === trackId)!
    expect(track.hidden).toBe(true)
    expect(track.name).toBe('Lớp nền')
  })

  it('gọi set_track mà không nêu gì thì báo lỗi', () => {
    const { document, trackId } = withClip()
    const plan = planChatToolCalls(context(document), [
      { name: 'set_track', arguments: { trackId } }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ đặt clip trong khung hình', () => {
  it('đặt vị trí, cỡ và góc xoay', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls({ ...context(document), selectedClipIds: [clipId] }, [
      { name: 'set_clip_transform', arguments: { x: 0.5, y: -0.25, scale: 0.4, rotationDeg: 8 } }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clip = document.tracks.flatMap((track) => track.clips)[0]
    expect(clip.transform).toMatchObject({ x: 0.5, y: -0.25, scale: 0.4, rotationDeg: 8 })
  })

  it('chỉ nêu một trường thì giữ nguyên các trường còn lại', () => {
    const { document, clipId } = withClip()
    const ctx = { ...context(document), selectedClipIds: [clipId] }
    for (const call of [
      { name: 'set_clip_transform', arguments: { scale: 2 } },
      { name: 'set_clip_transform', arguments: { x: 0.3 } }
    ]) {
      const plan = planChatToolCalls(ctx, [call])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }

    // Ghi đè cả bảng mà không đọc lại giá trị cũ thì lệnh sau xoá việc lệnh trước.
    const clip = document.tracks.flatMap((track) => track.clips)[0]
    expect(clip.transform).toMatchObject({ scale: 2, x: 0.3 })
  })

  it('reset đưa về giá trị gốc', () => {
    const { document, clipId } = withClip()
    const ctx = { ...context(document), selectedClipIds: [clipId] }
    for (const call of [
      { name: 'set_clip_transform', arguments: { scale: 2, rotationDeg: 20 } },
      { name: 'set_clip_transform', arguments: { reset: true } }
    ]) {
      const plan = planChatToolCalls(ctx, [call])
      for (const command of plan.steps.flatMap((step) => step.commands)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
    expect(document.tracks.flatMap((track) => track.clips)[0].transform).toMatchObject({
      scale: 1,
      rotationDeg: 0
    })
  })

  it('gọi mà không nêu gì thì báo lỗi', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls({ ...context(document), selectedClipIds: [clipId] }, [
      { name: 'set_clip_transform', arguments: {} }
    ])
    expect(plan.steps).toEqual([])
    expect(plan.failures).toHaveLength(1)
  })
})

describe('công cụ hiệu ứng ra của clip', () => {
  it('đặt được hiệu ứng ở mép RA', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls({ ...context(document), selectedClipIds: [clipId] }, [
      {
        name: 'set_clip_transition',
        arguments: { edge: 'out', kind: 'fade', durationSeconds: 0.4 }
      }
    ])
    expect(plan.failures).toEqual([])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const clip = document.tracks.flatMap((track) => track.clips)[0]
    expect(clip.transitionOut?.kind).toBe('fade')
    // Không được đụng tới mép vào.
    expect(clip.transitionIn).toBeUndefined()
  })

  it('bỏ trống mép thì vẫn là mép VÀO như trước', () => {
    const { document, clipId } = withClip()
    const plan = planChatToolCalls({ ...context(document), selectedClipIds: [clipId] }, [
      { name: 'set_clip_transition', arguments: { kind: 'zoom' } }
    ])
    for (const command of plan.steps.flatMap((step) => step.commands)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    const clip = document.tracks.flatMap((track) => track.clips)[0]
    expect(clip.transitionIn?.kind).toBe('zoom')
    expect(clip.transitionOut).toBeUndefined()
  })
})
