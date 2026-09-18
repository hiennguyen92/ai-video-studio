import { describe, expect, it } from 'vitest'
import { planChatToolCalls } from './chat-tool-planner'
import { buildProjectContext } from './chat-context-builder'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import { createDefaultTextOverlayStyle } from '../domain/text-overlay-types'
import type { ProjectDocument } from '../domain/project-document-types'

/**
 * Công cụ keyframe cho agent.
 *
 * Chỗ dễ sai nhất KHÔNG phải cú pháp mà là HỆ QUY CHIẾU: `atSeconds` ở đây đếm
 * từ đầu clip, còn `atSeconds` của công cụ cắt clip đếm từ đầu timeline. Agent
 * nhầm hai thứ đó là sai hoàn toàn im lặng, nên có phép thử riêng cho nó.
 */

function project(): ProjectDocument {
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
    // Bắt đầu ở giây thứ 5: nếu chỗ nào nhầm mốc tuyệt đối với mốc tương đối
    // thì con số lệch đúng 5 giây và phép thử thấy ngay.
    startUs: 5_000_000,
    durationUs: 4_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    effects: [{ id: 'e1', kind: 'soft-blur', intensity: 0.3, params: {} }]
  })
  return document
}

const plan = (
  document: ProjectDocument,
  tool: string,
  args: Record<string, unknown>
): ReturnType<typeof planChatToolCalls> =>
  planChatToolCalls({ document, selectedClipIds: ['c1'], playheadUs: 0, makeId: () => 'gen_1' }, [
    { name: tool, arguments: args }
  ])

describe('agent đặt keyframe', () => {
  it('sinh đúng lệnh, và mốc tính TỪ ĐẦU CLIP', () => {
    const document = project()
    const result = plan(document, 'set_keyframe', {
      property: 'opacity',
      atSeconds: 1,
      value: 0.5
    })

    expect(result.failures).toEqual([])
    expect(result.steps[0].commands).toEqual([
      {
        type: 'keyframe/set',
        target: { kind: 'clip', clipId: 'c1' },
        path: 'transform.opacity',
        atUs: 1_000_000,
        value: 0.5,
        easing: undefined
      }
    ])
    // Clip bắt đầu ở giây thứ 5 mà mốc vẫn là 1 giây: đó là bằng chứng mốc
    // KHÔNG bị hiểu thành giờ tuyệt đối trên timeline.
    expect(document.tracks.find((track) => track.kind === 'video')!.clips[0].startUs).toBe(
      5_000_000
    )
  })

  it('lệnh sinh ra chạy được thật trên tài liệu', () => {
    const document = project()
    for (const step of plan(document, 'set_keyframe', {
      property: 'scale',
      atSeconds: 2,
      value: 1.5,
      easing: 'hold'
    }).steps) {
      for (const command of step.commands)
        expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    expect(clip.keyframes?.['transform.scale']).toEqual([{ atUs: 2_000_000, v: 1.5, e: 'hold' }])
  })

  it('mốc vượt quá độ dài clip bị từ chối, kèm lời nhắc về hệ quy chiếu', () => {
    // Đây chính là ca agent gửi giờ tuyệt đối trên timeline.
    const result = plan(project(), 'set_keyframe', {
      property: 'opacity',
      atSeconds: 7,
      value: 1
    })
    expect(result.steps).toEqual([])
    expect(result.failures[0].reason).toMatch(/TỪ ĐẦU clip/)
  })

  it('đặt cho cường độ effect theo id', () => {
    const result = plan(project(), 'set_keyframe', {
      property: 'effect_intensity',
      effectId: 'e1',
      atSeconds: 0,
      value: 1
    })
    expect(result.steps[0].commands[0]).toMatchObject({ path: 'effect.e1.intensity' })
  })

  it('effect không có trên clip thì báo lỗi tiếng Việt', () => {
    const result = plan(project(), 'set_keyframe', {
      property: 'effect_intensity',
      effectId: 'khong-ton-tai',
      atSeconds: 0,
      value: 1
    })
    expect(result.steps).toEqual([])
    expect(result.failures[0].reason).toContain('không có effect nào mang id')
  })

  it('thuộc tính của chữ mà thiếu overlayId thì báo lỗi', () => {
    const result = plan(project(), 'set_keyframe', {
      property: 'font_size',
      atSeconds: 0,
      value: 120
    })
    expect(result.failures[0].reason).toContain('Thiếu overlayId')
  })

  it('tên thuộc tính bịa ra bị chặn ngay ở cửa kiểm', () => {
    // Bảng tên là danh sách trắng, nên agent không gửi được đường dẫn tự chế.
    const result = plan(project(), 'set_keyframe', {
      property: 'transform.__proto__',
      atSeconds: 0,
      value: 1
    })
    expect(result.steps).toEqual([])
    expect(result.failures).toHaveLength(1)
  })

  it('xoá keyframe sinh đúng lệnh xoá', () => {
    const result = plan(project(), 'remove_keyframe', { property: 'opacity', atSeconds: 1 })
    expect(result.steps[0].commands[0]).toMatchObject({
      type: 'keyframe/remove',
      path: 'transform.opacity',
      atUs: 1_000_000
    })
  })
})

describe('agent NHÌN THẤY keyframe đang có', () => {
  it('clip chưa có keyframe thì phần tổng quan không nhắc tới', () => {
    expect(
      buildProjectContext({ document: project(), selectedClipIds: [], playheadUs: 0 })
    ).not.toContain('keyframes=')
  })

  it('in gọn: tên công cụ dùng, số lượng, và khoảng thời gian', () => {
    const document = project()
    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    clip.keyframes = {
      'transform.opacity': [
        { atUs: 0, v: 0 },
        { atUs: 1_000_000, v: 0.5 },
        { atUs: 2_500_000, v: 1 }
      ],
      'effect.e1.intensity': [{ atUs: 0, v: 1 }]
    }

    const context = buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })
    // Tên in ra phải là tên agent GỬI LẠI ĐƯỢC, không phải đường dẫn nội bộ.
    expect(context).toContain('keyframes=[opacity:3@0.0–2.5s; e1.intensity:1@0.0–0.0s]')
    expect(context).not.toContain('transform.opacity')
  })

  it('chữ overlay cũng in keyframe của nó', () => {
    const document = project()
    document.textOverlays.push({
      id: 'o1',
      text: 'Hook',
      startUs: 0,
      endUs: 2_000_000,
      animation: 'none',
      exitAnimation: 'none',
      style: createDefaultTextOverlayStyle(),
      keyframes: {
        'style.position.xPct': [
          { atUs: 0, v: 0.1 },
          { atUs: 2_000_000, v: 0.9 }
        ]
      }
    })
    expect(buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })).toContain(
      'keyframes=[text_x:2@0.0–2.0s]'
    )
  })
})
