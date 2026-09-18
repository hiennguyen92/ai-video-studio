import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import { createDefaultTextOverlayStyle } from '../domain/text-overlay-types'
import { migrateProjectDocument } from '../domain/project-document-migrations'
import { requiresRemotionRenderer } from '../domain/remotion-render-plan'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Clip } from '../domain/timeline-track-types'
import { applyEditorCommand } from './editor-command-reducer'
import { parseEditorCommand, type EditorCommand } from './editor-command-types'

/**
 * Lệnh keyframe và số phận của keyframe khi clip bị sửa.
 *
 * Phép thử bám vào THAO TÁC người dùng (đặt chấm, kéo clip, cắt mép, tách đôi,
 * đổi tốc độ) chứ không bám vào hàm, vì đó là chỗ tính năng này hỏng được: từng
 * hàm đúng nhưng nối sai chỗ thì chuyển động vẫn trôi khỏi hình.
 */

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 't' })
  document.assets.push({
    id: 'a',
    kind: 'video',
    name: 'a',
    source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 20_000_000, hasVideo: true, hasAudio: false },
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
    startUs: 1_000_000,
    durationUs: 4_000_000,
    sourceInUs: 2_000_000,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0
  })
  return document
}

const clip = (document: ProjectDocument, id = 'c1'): Clip =>
  document.tracks.find((item) => item.kind === 'video')!.clips.find((item) => item.id === id)!

const run = applyEditorCommand

const setOpacity = (atUs: number, value: number, easing?: 'hold'): EditorCommand => ({
  type: 'keyframe/set',
  target: { kind: 'clip', clipId: 'c1' },
  path: 'transform.opacity',
  atUs,
  value,
  easing
})

describe('đặt và xoá keyframe', () => {
  it('đặt xong đọc lại đúng giá trị', () => {
    const document = project()
    expect(run(document, setOpacity(0, 0.25)).ok).toBe(true)
    expect(clip(document).keyframes?.['transform.opacity']).toEqual([{ atUs: 0, v: 0.25 }])
  })

  it('đặt lại ở cùng mốc là GHI ĐÈ, không thêm cái thứ hai', () => {
    const document = project()
    run(document, setOpacity(500_000, 0.2))
    run(document, setOpacity(500_000, 0.8))
    expect(clip(document).keyframes?.['transform.opacity']).toEqual([{ atUs: 500_000, v: 0.8 }])
  })

  it('giá trị ngoài khoảng bị kẹp ngay lúc ghi', () => {
    // Kẹp lúc ghi thì phần vẽ khỏi kẹp lại mỗi khung, và một giá trị hỏng do
    // agent sinh không bao giờ nằm được trong tài liệu.
    const document = project()
    run(document, setOpacity(0, 40))
    expect(clip(document).keyframes?.['transform.opacity'][0].v).toBe(1)
  })

  it('xoá keyframe cuối cùng thì trường keyframes biến mất hẳn', () => {
    const document = project()
    run(document, setOpacity(0, 0.5))
    const removed = run(document, {
      type: 'keyframe/remove',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'transform.opacity',
      atUs: 0
    })
    expect(removed.ok).toBe(true)
    expect(clip(document).keyframes).toBeUndefined()
  })

  it('xoá ở mốc không có gì thì từ chối, không tạo bước hoàn tác rỗng', () => {
    const document = project()
    run(document, setOpacity(0, 0.5))
    const result = run(document, {
      type: 'keyframe/remove',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'transform.opacity',
      atUs: 999_999
    })
    expect(result).toEqual({
      ok: false,
      error: 'Không có keyframe nào của "transform.opacity" ở mốc này'
    })
  })

  it('kéo một keyframe sang mốc khác, giữ nguyên giá trị', () => {
    const document = project()
    run(document, setOpacity(0, 0.4))
    run(document, {
      type: 'keyframe/move',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'transform.opacity',
      fromAtUs: 0,
      toAtUs: 1_500_000,
      easing: 'hold'
    })
    expect(clip(document).keyframes?.['transform.opacity']).toEqual([
      { atUs: 1_500_000, v: 0.4, e: 'hold' }
    ])
  })
})

describe('lời từ chối', () => {
  it('đường dẫn không có trong danh mục', () => {
    const document = project()
    const result = run(document, {
      type: 'keyframe/set',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'transform.__proto__',
      atUs: 0,
      value: 1
    })
    expect(result).toEqual({
      ok: false,
      error: 'Thuộc tính "transform.__proto__" không đặt keyframe được'
    })
    expect(clip(document).keyframes).toBeUndefined()
  })

  it('effect không còn trong clip', () => {
    const document = project()
    const result = run(document, {
      type: 'keyframe/set',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'effect.khong-co-effect-nao.intensity',
      atUs: 0,
      value: 1
    })
    expect(result.ok).toBe(false)
  })

  it('track đang khoá', () => {
    const document = project()
    document.tracks.find((item) => item.kind === 'video')!.locked = true
    const result = run(document, setOpacity(0, 1))
    expect(result.ok).toBe(false)
  })

  it('ba lệnh đều qua được cửa kiểm zod', () => {
    // Quên đăng ký vào discriminatedUnion thì lệnh bị từ chối lúc CHẠY, và phép
    // thử dựa vào reducer sẽ không bắt được vì reducer nhận đối tượng dựng tay.
    for (const command of [
      setOpacity(0, 1),
      {
        type: 'keyframe/remove',
        target: { kind: 'clip', clipId: 'c1' },
        path: 'transform.opacity',
        atUs: 0
      },
      {
        type: 'keyframe/move',
        target: { kind: 'text', overlayId: 'o1' },
        path: 'style.fontSizePx',
        fromAtUs: 0,
        toAtUs: 1
      }
    ]) {
      expect(parseEditorCommand(command).ok).toBe(true)
    }
  })
})

describe('keyframe đi theo clip khi clip bị sửa', () => {
  it('kéo clip sang chỗ khác thì mốc giữ nguyên', () => {
    // Mốc tương đối chính là để chuyện này không tốn dòng mã nào.
    const document = project()
    run(document, setOpacity(500_000, 0.5))
    run(document, { type: 'clip/move', clipId: 'c1', toStartUs: 9_000_000, toTrackId: undefined })
    expect(clip(document).startUs).toBe(9_000_000)
    expect(clip(document).keyframes?.['transform.opacity'][0].atUs).toBe(500_000)
  })

  it('cắt mép đầu 1 giây thì mọi mốc lùi 1 giây', () => {
    const document = project()
    run(document, setOpacity(2_000_000, 1))
    run(document, { type: 'clip/trim', clipId: 'c1', edge: 'start', toUs: 2_000_000 })
    expect(clip(document).keyframes?.['transform.opacity'][0].atUs).toBe(1_000_000)
  })

  it('cắt mép cuối không đụng tới mốc nào', () => {
    const document = project()
    run(document, setOpacity(1_000_000, 1))
    run(document, { type: 'clip/trim', clipId: 'c1', edge: 'end', toUs: 3_000_000 })
    expect(clip(document).keyframes?.['transform.opacity'][0].atUs).toBe(1_000_000)
  })

  it('đổi tốc độ gấp đôi thì mốc co một nửa', () => {
    const document = project()
    run(document, setOpacity(2_000_000, 1))
    run(document, { type: 'clip/set-speed', clipId: 'c1', speed: 2 })
    expect(clip(document).keyframes?.['transform.opacity'][0].atUs).toBe(1_000_000)
  })

  it('tách clip thì hai nửa nối nhau đúng giá trị ở chỗ cắt', () => {
    const document = project()
    run(document, setOpacity(0, 0))
    run(document, setOpacity(4_000_000, 1))
    run(document, { type: 'clip/split', clipId: 'c1', atUs: 3_000_000, newClipId: 'c2' })

    const head = clip(document, 'c1').keyframes!['transform.opacity']
    const tail = clip(document, 'c2').keyframes!['transform.opacity']
    expect(head[head.length - 1].v).toBeCloseTo(0.5, 10)
    expect(tail[0]).toEqual({ atUs: 0, v: head[head.length - 1].v })
  })

  it('thả clip khác đè lên mép đầu thì keyframe dời theo mép bị đẩy', () => {
    // Đường này KHÔNG đi qua `splitClipAt` — nó dùng lại hai hàm cắt mép. Dễ
    // hỏng lặng lẽ nếu về sau ai đó dựng clip mới từ đầu thay vì cắt clip cũ.
    const document = project()
    run(document, setOpacity(2_000_000, 1))
    const track = document.tracks.find((item) => item.kind === 'video')!
    track.clips.push({ ...clip(document), id: 'c2', startUs: 10_000_000, durationUs: 2_000_000 })

    // Đẩy c2 đè lên 2 giây đầu của c1 → mép đầu c1 bị đẩy sang phải 1 giây.
    run(document, { type: 'clip/move', clipId: 'c2', toStartUs: 0, toTrackId: undefined })

    expect(clip(document).startUs).toBe(2_000_000)
    expect(clip(document).keyframes?.['transform.opacity'][0].atUs).toBe(1_000_000)
  })

  it('nhân bản clip rồi sửa bản sao thì bản gốc không đổi', () => {
    const document = project()
    run(document, setOpacity(0, 0.3))
    run(document, { type: 'clip/duplicate', clipId: 'c1', newClipId: 'c2' })
    run(document, {
      type: 'keyframe/set',
      target: { kind: 'clip', clipId: 'c2' },
      path: 'transform.opacity',
      atUs: 0,
      value: 0.9
    })
    expect(clip(document, 'c1').keyframes?.['transform.opacity'][0].v).toBe(0.3)
    expect(clip(document, 'c2').keyframes?.['transform.opacity'][0].v).toBe(0.9)
  })

  it('thay chồng effect thì keyframe của effect đã gỡ biến mất', () => {
    const document = project()
    run(document, {
      type: 'clip/set-effects',
      clipId: 'c1',
      effects: [{ id: 'e1', kind: 'soft-blur', intensity: 0.5, params: {} }]
    })
    run(document, {
      type: 'keyframe/set',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'effect.e1.intensity',
      atUs: 0,
      value: 0.8
    })
    expect(clip(document).keyframes?.['effect.e1.intensity']).toHaveLength(1)

    run(document, { type: 'clip/set-effects', clipId: 'c1', effects: [] })
    expect(clip(document).keyframes).toBeUndefined()
  })
})

describe('chữ overlay', () => {
  it('đặt keyframe cỡ chữ trên khối chữ', () => {
    const document = project()
    document.textOverlays.push({
      id: 'o1',
      text: 'Hook',
      startUs: 0,
      endUs: 2_000_000,
      animation: 'none',
      exitAnimation: 'none',
      style: createDefaultTextOverlayStyle()
    })

    const result = run(document, {
      type: 'keyframe/set',
      target: { kind: 'text', overlayId: 'o1' },
      path: 'style.fontSizePx',
      atUs: 500_000,
      value: 120
    })
    expect(result.ok).toBe(true)
    expect(document.textOverlays[0].keyframes?.['style.fontSizePx']).toEqual([
      { atUs: 500_000, v: 120 }
    ])
  })
})

describe('cổng chọn bộ dựng', () => {
  it('một keyframe là đủ để buộc đi Remotion', () => {
    // Nhánh ffmpeg đọc transform dạng hằng số. Thiếu cổng này thì bản xuất ra
    // file đứng hình mà không báo gì — người dùng chỉ phát hiện sau khi đã đăng.
    const document = project()
    expect(requiresRemotionRenderer(document)).toBe(false)
    run(document, setOpacity(0, 0.5))
    expect(requiresRemotionRenderer(document)).toBe(true)
  })

  it('gỡ hết keyframe thì lại xuất được bằng ffmpeg', () => {
    const document = project()
    run(document, setOpacity(0, 0.5))
    run(document, {
      type: 'keyframe/remove',
      target: { kind: 'clip', clipId: 'c1' },
      path: 'transform.opacity',
      atUs: 0
    })
    expect(requiresRemotionRenderer(document)).toBe(false)
  })
})

describe('tương thích file cũ', () => {
  it('dự án lưu trước khi có keyframe vẫn mở được', () => {
    const document = project() as unknown as Record<string, unknown>
    const migrated = migrateProjectDocument(document)
    const first = migrated.tracks.find((item) => item.kind === 'video')!.clips[0]
    // Không có trường nghĩa là không có chuyển động — và mọi thứ khác y như cũ.
    expect(first.keyframes).toBeUndefined()
    expect(requiresRemotionRenderer(migrated)).toBe(false)
  })
})
