import { describe, expect, it } from 'vitest'
import { textStyleAt } from './keyframe-text-style-at'
import { createDefaultTextOverlayStyle } from './text-overlay-types'
import { buildRenderPlan } from './remotion-render-plan'
import { createEmptyProject } from './project-document-factory'
import { textGizmoWriteCommands } from '../commands/text-gizmo-write-commands'
import type { ProjectDocument } from './project-document-types'
import type { ResolvedKeyframeTracks } from './keyframe-types'
import type { TextOverlay } from './text-overlay-types'

/**
 * Chữ overlay chạy theo keyframe, và cú kéo trên bản xem trước ghi vào đâu.
 */

const overlay = (extra: Partial<TextOverlay> = {}): TextOverlay => ({
  id: 'o1',
  text: 'Chốt đơn hôm nay',
  startUs: 1_000_000,
  endUs: 4_000_000,
  animation: 'none',
  exitAnimation: 'none',
  style: createDefaultTextOverlayStyle(),
  ...extra
})

const documentWith = (item: TextOverlay): ProjectDocument => {
  const document = createEmptyProject({ name: 't' })
  document.textOverlays.push(item)
  return document
}

describe('kiểu chữ tại một khung', () => {
  it('không có keyframe thì trả về CHÍNH object kiểu cũ', () => {
    const style = createDefaultTextOverlayStyle()
    expect(textStyleAt(undefined, 10, style)).toBe(style)
    // Có keyframe nhưng không phải của chữ thì cũng vậy.
    expect(textStyleAt({ 'transform.opacity': [{ f: 0, v: 1, e: 'linear' }] }, 10, style)).toBe(
      style
    )
  })

  it('vị trí chạy ngang theo keyframe', () => {
    const tracks: ResolvedKeyframeTracks = {
      'style.position.xPct': [
        { f: 0, v: 0.2, e: 'linear' },
        { f: 60, v: 0.8, e: 'linear' }
      ]
    }
    const style = createDefaultTextOverlayStyle()
    expect(textStyleAt(tracks, 30, style).position?.xPct).toBeCloseTo(0.5, 10)
  })

  it('chữ CHƯA ghim vị trí thì nền là chỗ alignment đang đặt nó, không phải góc', () => {
    // Đây là cái bẫy: lấy 0 làm nền thì lần đặt keyframe đầu tiên quăng chữ lên
    // góc trên-trái, và nhìn y như hỏng.
    const style = { ...createDefaultTextOverlayStyle(), alignment: 5 as const, position: undefined }
    const tracks: ResolvedKeyframeTracks = {
      'style.position.xPct': [{ f: 0, v: 0.9, e: 'linear' }]
    }
    const at0 = textStyleAt(tracks, 0, style)
    expect(at0.position?.xPct).toBe(0.9)
    // Trục dọc không có keyframe → giữ chỗ cũ (giữa khung với alignment 5), chứ
    // không rơi về 0.
    expect(at0.position?.yPct).toBe(0.5)
  })

  it('chữ neo đáy khung: nền của trục dọc là đáy', () => {
    const style = { ...createDefaultTextOverlayStyle(), alignment: 2 as const, position: undefined }
    const tracks: ResolvedKeyframeTracks = {
      'style.position.xPct': [{ f: 0, v: 0.5, e: 'linear' }]
    }
    expect(textStyleAt(tracks, 0, style).position?.yPct).toBe(1)
  })

  it('cỡ chữ và góc xoay chạy được, phần còn lại của kiểu giữ nguyên', () => {
    const style = { ...createDefaultTextOverlayStyle(), color: '#ff0000' }
    const tracks: ResolvedKeyframeTracks = {
      'style.fontSizePx': [
        { f: 0, v: 40, e: 'linear' },
        { f: 10, v: 140, e: 'linear' }
      ],
      'style.rotationDeg': [{ f: 0, v: 15, e: 'linear' }]
    }
    const at5 = textStyleAt(tracks, 5, style)
    expect(at5.fontSizePx).toBeCloseTo(90, 10)
    expect(at5.rotationDeg).toBe(15)
    expect(at5.color).toBe('#ff0000')
    // Chưa ghim vị trí và không có keyframe vị trí → vẫn chưa ghim.
    expect(at5.position).toBeUndefined()
  })
})

describe('đưa keyframe chữ vào kế hoạch dựng hình', () => {
  it('KHÔNG cộng lead-in, khác clip', () => {
    // Sequence của khối chữ bắt đầu đúng tại mốc của nó, không bị trừ đi đoạn
    // chuyển cảnh nào. Chép cách làm của clip sang đây là đẩy chữ chạy trễ.
    const plan = buildRenderPlan(
      documentWith(overlay({ keyframes: { 'style.position.xPct': [{ atUs: 1_000_000, v: 0.8 }] } }))
    )
    expect(plan.textOverlays[0].keyframes?.['style.position.xPct']).toEqual([
      { f: 30, v: 0.8, e: 'linear' }
    ])
  })
})

describe('kéo chữ trên bản xem trước', () => {
  const dragged = { position: { xPct: 0.7, yPct: 0.3 }, rotationDeg: 12 }

  it('chưa có keyframe nào thì ghi giá trị tĩnh, y như trước', () => {
    const commands = textGizmoWriteCommands(overlay(), dragged, 2_000_000)
    expect(commands).toHaveLength(1)
    expect(commands[0].type).toBe('text/set-style')
  })

  it('thuộc tính đã có keyframe thì ghi vào keyframe tại đầu phát', () => {
    const item = overlay({ keyframes: { 'style.position.xPct': [{ atUs: 0, v: 0.2 }] } })
    // Đầu phát ở giây thứ 2, khối chữ bắt đầu ở giây thứ 1 → mốc 1 giây.
    const commands = textGizmoWriteCommands(item, dragged, 2_000_000)

    const keyframeCommands = commands.filter((command) => command.type === 'keyframe/set')
    expect(keyframeCommands).toEqual([
      {
        type: 'keyframe/set',
        target: { kind: 'text', overlayId: 'o1' },
        path: 'style.position.xPct',
        atUs: 1_000_000,
        value: 0.7
      }
    ])

    // Trục dọc và góc xoay chưa có keyframe nên vẫn đi đường tĩnh — một cú kéo
    // không tự bật chế độ keyframe cho những thuộc tính người dùng chưa chọn.
    const styleCommand = commands.find((command) => command.type === 'text/set-style')
    expect(styleCommand).toBeDefined()
    if (styleCommand?.type === 'text/set-style') {
      expect(styleCommand.style.position?.yPct).toBe(0.3)
      expect(styleCommand.style.rotationDeg).toBe(12)
    }
  })

  it('mọi thuộc tính đều có keyframe thì không còn lệnh ghi tĩnh nào', () => {
    const item = overlay({
      keyframes: {
        'style.position.xPct': [{ atUs: 0, v: 0.2 }],
        'style.position.yPct': [{ atUs: 0, v: 0.2 }],
        'style.rotationDeg': [{ atUs: 0, v: 0 }]
      }
    })
    const commands = textGizmoWriteCommands(item, dragged, 2_000_000)
    expect(commands).toHaveLength(3)
    expect(commands.every((command) => command.type === 'keyframe/set')).toBe(true)
  })

  it('đầu phát trước khối chữ thì mốc kẹp về 0, không sinh lệnh bị từ chối', () => {
    const item = overlay({ keyframes: { 'style.position.xPct': [{ atUs: 0, v: 0.2 }] } })
    const commands = textGizmoWriteCommands(item, dragged, 0)
    const first = commands[0]
    expect(first.type === 'keyframe/set' && first.atUs).toBe(0)
  })
})
