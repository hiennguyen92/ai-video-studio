import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { planChatToolCalls } from '../ai/chat-tool-planner'
import { createEmptyProject } from './project-document-factory'
import { migrateProjectDocument } from './project-document-migrations'
import { projectDurationUs, type ProjectDocument } from './project-document-types'
import { buildRenderPlan, requiresRemotionRenderer } from './remotion-render-plan'
import { createDefaultTextOverlayStyle, type TextOverlay } from './text-overlay-types'

/**
 * Chữ đè lên hình.
 *
 * Khác phụ đề ở chỗ nó do người dùng (hoặc AI) tự viết và tự đặt giờ, nên nó phải
 * sống sót qua việc dựng lại phụ đề, và phải kéo dài được video khi nằm sau clip
 * cuối cùng.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function overlay(overrides: Partial<TextOverlay> = {}): TextOverlay {
  return {
    id: 'text_1',
    text: 'Chốt đơn ngay',
    startUs: 1_000_000,
    endUs: 3_000_000,
    style: createDefaultTextOverlayStyle(),
    animation: 'pop',
    animationDurationUs: 350_000,
    ...overrides
  }
}

function project(): ProjectDocument {
  return createEmptyProject({ name: 'Thử' })
}

describe('lệnh chữ overlay', () => {
  it('thêm được và giữ nguyên nội dung', () => {
    const document = project()
    const result = applyEditorCommand(document, { type: 'text/add', overlay: overlay() })

    expect(result.ok).toBe(true)
    expect(document.textOverlays[0].text).toBe('Chốt đơn ngay')
  })

  it('từ chối khoảng thời gian ngược', () => {
    const document = project()
    const result = applyEditorCommand(document, {
      type: 'text/add',
      overlay: overlay({ startUs: 3_000_000, endUs: 1_000_000 })
    })
    expect(result.ok).toBe(false)
    expect(document.textOverlays).toHaveLength(0)
  })

  it('từ chối sửa thành khoảng ngược thay vì để chữ biến mất âm thầm', () => {
    const document = project()
    applyEditorCommand(document, { type: 'text/add', overlay: overlay() })

    const result = applyEditorCommand(document, {
      type: 'text/update',
      overlayId: 'text_1',
      endUs: 500_000
    })
    expect(result.ok).toBe(false)
    expect(document.textOverlays[0].endUs).toBe(3_000_000)
  })

  it('sửa được chữ và hiệu ứng', () => {
    const document = project()
    applyEditorCommand(document, { type: 'text/add', overlay: overlay() })
    applyEditorCommand(document, {
      type: 'text/update',
      overlayId: 'text_1',
      text: 'Giảm 50% hôm nay',
      animation: 'typewriter'
    })

    expect(document.textOverlays[0].text).toBe('Giảm 50% hôm nay')
    expect(document.textOverlays[0].animation).toBe('typewriter')
  })

  it('xoá được', () => {
    const document = project()
    applyEditorCommand(document, { type: 'text/add', overlay: overlay() })
    applyEditorCommand(document, { type: 'text/remove', overlayId: 'text_1' })
    expect(document.textOverlays).toHaveLength(0)
  })
})

describe('kế hoạch render', () => {
  it('đổi mốc thời gian sang khung và kẹp hiệu ứng theo độ dài overlay', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'text/add',
      // Overlay chỉ dài 0,2 giây nhưng hiệu ứng khai 1 giây.
      overlay: overlay({ startUs: 0, endUs: 200_000, animationDurationUs: 1_000_000 })
    })

    const plan = buildRenderPlan(document)
    expect(plan.textOverlays).toHaveLength(1)
    expect(plan.textOverlays[0].durationInFrames).toBe(6)
    // Hiệu ứng dài hơn chính overlay là vô nghĩa; phải bị kẹp lại.
    expect(plan.textOverlays[0].animationFrames).toBe(6)
  })

  it('bỏ overlay ngắn hơn một khung', () => {
    const document = project()
    document.textOverlays.push(overlay({ startUs: 0, endUs: 1000 }))
    expect(buildRenderPlan(document).textOverlays).toHaveLength(0)
  })
})

describe('ảnh hưởng tới thời lượng video', () => {
  it('chữ nằm sau clip cuối vẫn kéo dài video', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'text/add',
      overlay: overlay({ startUs: 8_000_000, endUs: 12_000_000 })
    })

    // Không tính vào đây thì CTA đặt cuối video sẽ bị cắt mất khi xuất.
    expect(projectDurationUs(document)).toBe(12_000_000)
  })
})

describe('tương thích file cũ', () => {
  it('dự án lưu trước khi có tính năng này vẫn mở được', () => {
    const document = project() as unknown as Record<string, unknown>
    delete document.textOverlays

    const migrated = migrateProjectDocument(document)
    expect(migrated.textOverlays).toEqual([])
  })
})

describe('công cụ AI', () => {
  it('AI thêm được chữ, mặc định nằm giữa khung hình', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      {
        name: 'add_text_overlay',
        arguments: { text: 'Bạn đang bỏ lỡ thứ này', startSeconds: 0, endSeconds: 3 }
      }
    ])

    expect(plan.steps).toHaveLength(1)
    for (const command of plan.steps[0].commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }

    const added = document.textOverlays[0]
    expect(added.text).toBe('Bạn đang bỏ lỡ thứ này')
    // 5 = giữa khung hình, chỗ hook phải nằm.
    expect(added.style.alignment).toBe(5)
    expect(added.animation).toBe('pop')
  })

  it('nhận vị trí bằng chữ, không bắt mô hình đoán số bàn phím của ASS', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      {
        name: 'add_text_overlay',
        arguments: { text: 'CTA', startSeconds: 0, endSeconds: 2, position: 'bottom' }
      }
    ])
    for (const command of plan.steps[0].commands) applyEditorCommand(document, command)

    expect(document.textOverlays[0].style.alignment).toBe(2)
  })

  it('từ chối khoảng thời gian ngược ngay từ bước dựng lệnh', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      { name: 'add_text_overlay', arguments: { text: 'x', startSeconds: 5, endSeconds: 2 } }
    ])

    expect(plan.steps).toEqual([])
    expect(plan.failures[0].reason).toContain('phải sau')
  })

  it('từ chối xoá overlay không tồn tại', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      { name: 'remove_text_overlay', arguments: { overlayId: 'khong_co' } }
    ])
    expect(plan.failures[0].reason).toContain('Không tìm thấy')
  })
})

describe('chọn bộ dựng theo nội dung dự án', () => {
  it('dự án trơn thì ffmpeg dùng được', () => {
    expect(requiresRemotionRenderer(project())).toBe(false)
  })

  it('có chữ overlay thì bắt buộc Remotion', () => {
    const document = project()
    applyEditorCommand(document, { type: 'text/add', overlay: overlay() })

    // ffmpeg không vẽ được chữ overlay; xuất bằng nó sẽ ra file thiếu chữ mà
    // không báo gì — người dùng chỉ phát hiện khi đã đăng video.
    expect(requiresRemotionRenderer(document)).toBe(true)
  })

  it('có chuyển cảnh thì bắt buộc Remotion', () => {
    const document = project()
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
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: 'clip_1',
      trackId,
      assetId: 'asset_1',
      startUs: 2_000_000,
      durationUs: 2_000_000,
      sourceInUs: 2_000_000
    })
    expect(requiresRemotionRenderer(document)).toBe(false)

    applyEditorCommand(document, {
      type: 'clip/set-transition',
      clipId: 'clip_1',
      transition: { kind: 'fade', durationUs: 500_000 }
    })
    expect(requiresRemotionRenderer(document)).toBe(true)
  })
})
