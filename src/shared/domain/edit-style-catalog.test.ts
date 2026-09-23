import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { planChatToolCalls } from '../ai/chat-tool-planner'
import { chatToolSchemas, isChatToolName } from '../ai/chat-tool-catalog'
import { createEmptyProject, createId } from './project-document-factory'
import { findClipLook } from './clip-look-catalog'
import { findClipEffect } from './clip-effect-catalog'
import type { ProjectDocument } from './project-document-types'
import { EDIT_STYLES, findEditStyle } from './edit-style-catalog'
import { editStyleAspectMismatch, expandEditStyle } from './edit-style-expand'

/**
 * Kiểu dựng.
 *
 * Hai thứ phải đúng, và cả hai đều hỏng âm thầm nếu sai:
 *
 *   - **Bước trỏ tới công cụ CÓ THẬT, với tham số HỢP LỆ.** Kiểu dựng là dữ liệu,
 *     nên TypeScript chỉ canh được tên công cụ chứ không canh được tham số. Catalog
 *     công cụ đổi một ràng buộc mà kiểu dựng không đổi theo thì thẻ vẫn bấm được,
 *     chỉ là không có gì xảy ra.
 *   - **Giãn đúng phạm vi.** "Từng clip" phải là từng clip thật trên tài liệu này,
 *     không phải clip đang chọn.
 */

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

function addClip(document: ProjectDocument, trackId: string, startUs: number): string {
  const clipId = createId('clip')
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId,
    trackId,
    assetId: 'asset_1',
    startUs,
    durationUs: 3_000_000,
    sourceInUs: 1_000_000
  })
  if (!result.ok) throw new Error(result.error)
  return clipId
}

const videoTrack = (document: ProjectDocument): string =>
  document.tracks.find((track) => track.kind === 'video')!.id

/** Ba clip liền nhau trên track hình → hai chỗ nối. */
function threeClips(): ProjectDocument {
  const document = project()
  const trackId = videoTrack(document)
  addClip(document, trackId, 0)
  addClip(document, trackId, 3_000_000)
  addClip(document, trackId, 6_000_000)
  return document
}

describe('mọi bước của mọi kiểu dựng đều hợp lệ với catalog công cụ', () => {
  it('tên công cụ có thật', () => {
    for (const style of EDIT_STYLES) {
      for (const step of style.steps) {
        expect(isChatToolName(step.tool), `${style.id} → ${step.tool}`).toBe(true)
      }
    }
  })

  it('tham số qua được schema của chính công cụ đó', () => {
    // Đây là phép thử chống TRÔI: catalog công cụ siết một ràng buộc mà kiểu dựng
    // không đổi theo thì thẻ vẫn bấm được, chỉ là bước đó lặng lẽ rơi.
    const document = threeClips()
    for (const style of EDIT_STYLES) {
      for (const call of expandEditStyle(style, document)) {
        const schema = chatToolSchemas[call.name as keyof typeof chatToolSchemas]
        const parsed = schema.safeParse(call.arguments)
        expect(
          parsed.success,
          `${style.id} → ${call.name}: ${JSON.stringify(call.arguments)}`
        ).toBe(true)
      }
    }
  })
})

describe('id tra vào danh mục khác phải có thật', () => {
  it('mọi filterId có trong danh mục look, mọi effect có trong danh mục effect', () => {
    // Schema của `set_clip_filter` và `add_clip_effect` chỉ nhận CHUỖI bất kỳ,
    // nên phép thử schema ở trên không bắt được tên gõ sai. Sai tên thì công cụ
    // vẫn nhận, app vẫn chạy, và không có gì xảy ra — đúng kiểu hỏng tệ nhất.
    const document = threeClips()
    for (const style of EDIT_STYLES) {
      for (const call of expandEditStyle(style, document)) {
        if (call.name === 'set_clip_filter') {
          const id = call.arguments.filterId as string
          expect(findClipLook(id), `${style.id} → look "${id}"`).toBeDefined()
        }
        if (call.name === 'add_clip_effect') {
          const kind = call.arguments.kind as string
          expect(findClipEffect(kind), `${style.id} → effect "${kind}"`).toBeDefined()
        }
      }
    }
  })
})

describe('biến thể xoay vòng', () => {
  it('mỗi clip nhận một biến thể khác nhau, xoay vòng theo thứ tự', () => {
    // Cùng một chuyển động cho mọi clip là thứ tố cáo ngay rằng video do máy dựng.
    const kinds = expandEditStyle(findEditStyle('travel-vlog')!, threeClips())
      .filter((call) => call.name === 'set_clip_zoom')
      .map((call) => call.arguments.kind)
    expect(kinds).toEqual(['zoom-in', 'pan-left', 'zoom-out'])
  })

  it('quay lại từ đầu khi hết biến thể', () => {
    const document = threeClips()
    const trackId = videoTrack(document)
    addClip(document, trackId, 9_000_000)
    addClip(document, trackId, 12_000_000)
    const kinds = expandEditStyle(findEditStyle('travel-vlog')!, document)
      .filter((call) => call.name === 'set_clip_zoom')
      .map((call) => call.arguments.kind)
    expect(kinds).toEqual(['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'zoom-in'])
  })

  it('`null` là bỏ qua mục đó, không phải đặt cường độ 0', () => {
    // Cường độ 0 vẫn THÊM effect vào clip: vẫn tốn một lớp vẽ, vẫn nằm trong
    // Inspector, và người dùng phải tự xoá một thứ không làm gì.
    const leaks = expandEditStyle(findEditStyle('retro-film')!, threeClips()).filter(
      (call) => call.name === 'add_clip_effect' && call.arguments.kind === 'light-leak'
    )
    expect(leaks).toHaveLength(2)
    expect(leaks.every((call) => (call.arguments.intensity as number) > 0)).toBe(true)
  })

  it('cảnh đứng yên trong vòng xoay GỠ chuyển động, không phải bỏ qua', () => {
    // Bỏ qua thì clip giữ nguyên chuyển động của kiểu dựng áp trước đó, và kết
    // quả hoá ra phụ thuộc lịch sử: áp Vlog rồi áp Điện ảnh sẽ còn sót cú lia.
    const kinds = expandEditStyle(findEditStyle('cinematic')!, threeClips())
      .filter((call) => call.name === 'set_clip_zoom')
      .map((call) => call.arguments.kind)
    expect(kinds).toEqual(['zoom-in', 'zoom-out', 'none'])
  })

  it('biến thể đắp LÊN tham số chung, không xoá nó', () => {
    const calls = expandEditStyle(findEditStyle('travel-vlog')!, threeClips())
    const zoom = calls.find((call) => call.name === 'set_clip_zoom')!
    expect(zoom.arguments).toMatchObject({ kind: 'zoom-in', intensity: 0.4 })
  })
})

describe('giãn kiểu dựng ra timeline thật', () => {
  it('đổi khung GIỮ nguyên độ phân giải của dự án', () => {
    // Kiểm qua ĐÚNG bộ lập kế hoạch chứ không kiểm tham số gửi đi: kiểu dựng chỉ
    // nói hướng, còn giữ độ phân giải là luật của chính công cụ `set_canvas`.
    // Kiểm tham số thì mai kia luật đổi chỗ mà phép thử vẫn xanh.
    const uhd = threeClips()
    uhd.settings = { ...uhd.settings, aspectRatio: '9:16', width: 2160, height: 3840 }
    expect(canvasAfter(findEditStyle('cinematic')!, uhd)).toEqual({ width: 3840, height: 2160 })
  })

  it('dự án 1080 thì vẫn ra 1080, không tự nâng', () => {
    expect(canvasAfter(findEditStyle('cinematic')!, threeClips())).toEqual({
      width: 1920,
      height: 1080
    })
  })

  it('bước cho cả dự án chỉ gọi một lần, dù có bao nhiêu clip', () => {
    const calls = expandEditStyle(findEditStyle('vertical-short')!, threeClips())
    expect(calls.filter((call) => call.name === 'set_canvas')).toHaveLength(1)
  })

  it('bước cho từng clip gọi đúng một lần mỗi clip, kèm id clip', () => {
    const calls = expandEditStyle(findEditStyle('vertical-short')!, threeClips())
    const zooms = calls.filter((call) => call.name === 'set_clip_zoom')
    expect(zooms).toHaveLength(3)
    expect(new Set(zooms.map((call) => call.arguments.clipId)).size).toBe(3)
  })

  it('bước cho chỗ nối gọi theo SỐ CHỖ NỐI, không theo số clip', () => {
    // Ba clip liền nhau là hai chỗ nối. Gọi ba lần là clip cuối nhận một chuyển
    // cảnh ra không có ai đứng sau để gặp.
    const calls = expandEditStyle(findEditStyle('cinematic')!, threeClips())
    const cuts = calls.filter((call) => call.name === 'set_cut_transition')
    expect(cuts).toHaveLength(2)
    expect(cuts.every((call) => typeof call.arguments.fromClipId === 'string')).toBe(true)
  })

  it('clip rời nhau thì không có chỗ nối nào', () => {
    const document = project()
    const trackId = videoTrack(document)
    addClip(document, trackId, 0)
    addClip(document, trackId, 20_000_000)
    const calls = expandEditStyle(findEditStyle('cinematic')!, document)
    expect(calls.filter((call) => call.name === 'set_cut_transition')).toHaveLength(0)
  })

  it('track ẩn bị bỏ qua', () => {
    // Áp một look lên thứ người dùng không nhìn thấy là sửa dự án sau lưng họ.
    const document = threeClips()
    document.tracks.find((track) => track.kind === 'video')!.hidden = true
    const calls = expandEditStyle(findEditStyle('vertical-short')!, document)
    expect(calls.filter((call) => call.name === 'set_clip_zoom')).toHaveLength(0)
    // Bước cho cả dự án vẫn chạy: khung hình không thuộc track nào.
    expect(calls.filter((call) => call.name === 'set_canvas')).toHaveLength(1)
  })

  it('timeline trống thì chỉ còn bước cho cả dự án', () => {
    const calls = expandEditStyle(findEditStyle('tutorial')!, project())
    expect(calls).toHaveLength(1)
    expect(calls[0].name).toBe('set_canvas')
  })
})

describe('danh mục', () => {
  it('id không trùng nhau', () => {
    expect(new Set(EDIT_STYLES.map((style) => style.id)).size).toBe(EDIT_STYLES.length)
  })

  it('kiểu nào cũng đặt khung hình trước, rồi mới dựng', () => {
    // Đổi khung sau khi đã đặt chuyển động là đặt lên một khung ngắm sắp bị thay.
    for (const style of EDIT_STYLES) {
      expect(style.steps[0]?.tool, style.id).toBe('set_canvas')
    }
  })

  it('id lạ thì không trả về gì', () => {
    expect(findEditStyle('khong-co')).toBeUndefined()
  })
})

/** Khung dự án SAU khi áp kiểu dựng, tính qua đúng bộ lập kế hoạch. */
function canvasAfter(
  style: Parameters<typeof expandEditStyle>[0],
  document: ProjectDocument
): { width: number; height: number } {
  const plan = planChatToolCalls(
    { document, selectedClipIds: [], playheadUs: 0, makeId: () => createId('clip') },
    expandEditStyle(style, document)
  )
  const next = structuredClone(document)
  for (const step of plan.steps) {
    for (const command of step.commands) applyEditorCommand(next, command)
  }
  return { width: next.settings.width, height: next.settings.height }
}

describe('cảnh báo đổi hướng khung', () => {
  /** Dự án khung DỌC, có sẵn clip hình. */
  function portrait(): ProjectDocument {
    const document = threeClips()
    document.settings = { ...document.settings, aspectRatio: '9:16', width: 1080, height: 1920 }
    return document
  }

  it('kiểu 16:9 áp lên dự án dọc thì cảnh báo', () => {
    // Khung dự án đã khớp hướng footage từ lúc nhập, nên đổi hướng ở đây nghĩa là
    // mọi clip đang có sẽ nằm trong hai dải đen.
    expect(editStyleAspectMismatch(findEditStyle('cinematic')!, portrait())).toEqual({
      from: '9:16',
      to: '16:9'
    })
  })

  it('kiểu cùng hướng thì im lặng', () => {
    expect(editStyleAspectMismatch(findEditStyle('vertical-short')!, portrait())).toBeNull()
  })

  it('kiểu tự lấp hai dải bằng nền mờ thì KHÔNG cảnh báo', () => {
    // "Ngang sang dọc" đổi hướng là việc của nó, và nó đã lấp sẵn bằng nền mờ.
    // Cảnh báo nó là báo nhầm đúng thứ sinh ra để chữa.
    const landscape = threeClips()
    expect(editStyleAspectMismatch(findEditStyle('repurpose-vertical')!, landscape)).toBeNull()
  })

  it('timeline còn trống thì không có gì để đóng hộp', () => {
    const empty = project()
    empty.settings = { ...empty.settings, aspectRatio: '9:16', width: 1080, height: 1920 }
    expect(editStyleAspectMismatch(findEditStyle('cinematic')!, empty)).toBeNull()
  })
})
