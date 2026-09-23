import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject, createId } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import {
  DEFAULT_SUBTITLE_STYLE,
  createDefaultSubtitleStyle,
  scaleSubtitleStylePx
} from './subtitle-types'
import { createDefaultTextOverlayStyle } from './text-overlay-types'

/**
 * Cỡ chữ và độ phân giải khung.
 *
 * Cỡ chữ tính bằng PIXEL chỉ có nghĩa khi biết khung cao bao nhiêu: 84px trên
 * khung 1080 chiếm 7,8% chiều cao, cũng 84px đó trên khung 4K chỉ còn 3,9%.
 *
 * Hai chỗ phải đúng, và cả hai đều hỏng âm thầm nếu sai:
 *
 *   - Chữ MỚI sinh ra phải quy theo khung đang dùng.
 *   - Chữ ĐANG CÓ phải nhân theo khi đổi độ phân giải — đổi 1080 lên 4K là đổi
 *     chất lượng, không phải đổi bố cục.
 */

function withOverlay(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.textOverlays.push({
    id: createId('text'),
    text: 'Chốt đơn',
    startUs: 0,
    endUs: 3_000_000,
    style: createDefaultTextOverlayStyle(1080),
    animation: 'none',
    animationDurationUs: 0
  })
  document.subtitleTracks.push({
    id: createId('track'),
    name: 'Phụ đề 1',
    language: 'vi',
    cues: [],
    style: createDefaultSubtitleStyle(1080)
  })
  return document
}

const setCanvas = (document: ProjectDocument, width: number, height: number): void => {
  const result = applyEditorCommand(document, {
    type: 'project/set-settings',
    settings: { width, height }
  })
  if (!result.ok) throw new Error(result.error)
}

describe('cỡ chữ mặc định quy theo khung', () => {
  it('khung 4K cho chữ to gấp đôi khung 1080', () => {
    expect(createDefaultTextOverlayStyle(1080).fontSizePx).toBe(84)
    expect(createDefaultTextOverlayStyle(2160).fontSizePx).toBe(168)
    expect(createDefaultSubtitleStyle(2160).fontSizePx).toBe(DEFAULT_SUBTITLE_STYLE.fontSizePx * 2)
  })

  it('viền và bóng cũng nhân theo, không mình cỡ chữ', () => {
    // Chữ to gấp đôi mà viền giữ nguyên 3px thì ở khung 4K viền mỏng như sợi tóc.
    const style = createDefaultSubtitleStyle(2160)
    expect(style.outlineWidthPx).toBe(DEFAULT_SUBTITLE_STYLE.outlineWidthPx * 2)
  })

  it('trường đang bằng 0 thì vẫn bằng 0', () => {
    // Bóng tắt là bóng tắt; nhân lên không được bật nó dậy.
    expect(scaleSubtitleStylePx({ ...DEFAULT_SUBTITLE_STYLE, shadowPx: 0 }, 4).shadowPx).toBe(0)
  })

  it('viền mỏng không bị làm tròn về 0 khi thu nhỏ', () => {
    expect(
      scaleSubtitleStylePx({ ...DEFAULT_SUBTITLE_STYLE, outlineWidthPx: 1 }, 0.25).outlineWidthPx
    ).toBe(1)
  })
})

describe('đổi độ phân giải kéo theo chữ đang có', () => {
  it('nâng 1080 lên 4K thì chữ và phụ đề cùng to gấp đôi', () => {
    const document = withOverlay()
    const before = document.textOverlays[0].style.fontSizePx
    setCanvas(document, 3840, 2160)
    expect(document.textOverlays[0].style.fontSizePx).toBe(before * 2)
    expect(document.subtitleTracks[0].style.fontSizePx).toBe(DEFAULT_SUBTITLE_STYLE.fontSizePx * 2)
  })

  it('đổi TỈ LỆ ở cùng mức độ phân giải KHÔNG đụng tới chữ', () => {
    // 16:9 1080p sang 9:16 1080p: cạnh ngắn vẫn 1080, nên đây không phải đổi độ
    // phân giải. Nhân theo chiều cao sẽ làm chữ to lên 1,78 lần không lý do.
    const document = withOverlay()
    const before = document.textOverlays[0].style.fontSizePx
    setCanvas(document, 1080, 1920)
    expect(document.textOverlays[0].style.fontSizePx).toBe(before)
  })

  it('lên rồi xuống thì về đúng chỗ cũ', () => {
    const document = withOverlay()
    const before = document.textOverlays[0].style.fontSizePx
    setCanvas(document, 3840, 2160)
    setCanvas(document, 1920, 1080)
    expect(document.textOverlays[0].style.fontSizePx).toBe(before)
  })

  it('đổi thứ khác trong thiết lập thì chữ đứng yên', () => {
    const document = withOverlay()
    const before = document.textOverlays[0].style.fontSizePx
    const result = applyEditorCommand(document, {
      type: 'project/set-settings',
      settings: { backgroundColor: '#123456' }
    })
    expect(result.ok).toBe(true)
    expect(document.textOverlays[0].style.fontSizePx).toBe(before)
  })
})
