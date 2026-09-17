import type { z } from 'zod'
import type { EditorCommand } from '../commands/editor-command-types'
import type { ProjectDocument } from '../domain/project-document-types'
import { SUBTITLE_STYLE_PRESETS, type SubtitleStyle } from '../domain/subtitle-types'
import { applyTextOverlayBox } from '../domain/text-overlay-types'
import type { chatToolSchemas } from './chat-tool-catalog'

/**
 * Dịch `set_text_style` thành lệnh: phần kiểu chữ mà panel Style/Layout chỉnh được
 * nhưng các công cụ màu, phông, xoay, ghim vị trí chưa phủ — cỡ chữ, nền hộp, neo
 * trên/giữa/dưới, lề, bóng, số ký tự mỗi dòng, mẫu phụ đề.
 *
 * Chỉ ghi đè trường được nêu, như thanh trượt trên giao diện: đổi cỡ chữ không
 * được xoá mất màu hay viền đã chỉnh.
 */

type SetTextStyleInput = z.infer<(typeof chatToolSchemas)['set_text_style']>
type Planned = { description: string; commands: EditorCommand[] }

/** Cỡ chữ tối đa của phụ đề, khớp thanh trượt; chữ overlay lên được 300. */
const MAX_SUBTITLE_FONT_SIZE_PX = 200

/** Lề mặc định khi neo chữ overlay lên đỉnh/đáy, cùng giá trị với `add_text_overlay`. */
const OVERLAY_EDGE_MARGIN_PX = 160

const POSITION_ALIGNMENT = { bottom: 2, middle: 5, top: 8 } as const

function hasAnyField(input: SetTextStyleInput): boolean {
  return (
    input.preset !== undefined ||
    input.fontSizePx !== undefined ||
    input.box !== undefined ||
    input.boxColor !== undefined ||
    input.boxOpacity !== undefined ||
    input.position !== undefined ||
    input.marginVerticalPx !== undefined ||
    input.shadowPx !== undefined ||
    input.maxCharsPerLine !== undefined
  )
}

/** Áp các trường chung cho cả phụ đề lẫn chữ overlay. */
function applyCommonFields(
  base: SubtitleStyle,
  input: SetTextStyleInput,
  defaultEdgeMarginPx?: number
): SubtitleStyle {
  let style = input.box !== undefined ? applyTextOverlayBox(base, input.box) : { ...base }
  if (input.boxColor !== undefined) style.boxColor = input.boxColor
  if (input.boxOpacity !== undefined) style.boxOpacity = input.boxOpacity
  if (input.fontSizePx !== undefined) style.fontSizePx = input.fontSizePx

  if (input.position !== undefined) {
    style.alignment = POSITION_ALIGNMENT[input.position]
    // Như ô vị trí trên giao diện: nằm giữa thì lề dọc vô nghĩa, đặt về 0.
    if (defaultEdgeMarginPx !== undefined) {
      style.marginVerticalPx = input.position === 'middle' ? 0 : defaultEdgeMarginPx
    }
    // Chữ đang bị ghim thì alignment không có tác dụng; neo lại nghĩa là bỏ ghim,
    // nếu không agent đổi vị trí mà chữ đứng yên.
    style = { ...style }
    delete style.position
  }
  if (input.marginVerticalPx !== undefined) style.marginVerticalPx = input.marginVerticalPx
  return style
}

function planSubtitleStyle(
  document: ProjectDocument,
  subtitleTrackId: string,
  input: SetTextStyleInput
): Planned {
  const track = document.subtitleTracks.find((item) => item.id === subtitleTrackId)
  if (!track) throw new Error(`Không tìm thấy track phụ đề "${subtitleTrackId}"`)
  if (input.fontSizePx !== undefined && input.fontSizePx > MAX_SUBTITLE_FONT_SIZE_PX) {
    throw new Error(`Cỡ chữ phụ đề tối đa ${MAX_SUBTITLE_FONT_SIZE_PX}px`)
  }

  let base = track.style
  if (input.preset !== undefined) {
    const preset = SUBTITLE_STYLE_PRESETS.find((item) => item.id === input.preset)
    if (!preset) {
      throw new Error(
        `Không có mẫu phụ đề "${input.preset}". Có: ${SUBTITLE_STYLE_PRESETS.map((item) => item.id).join(', ')}`
      )
    }
    base = { ...base, ...preset.style }
  }

  const style = applyCommonFields(base, input)
  if (input.shadowPx !== undefined) style.shadowPx = input.shadowPx
  if (input.maxCharsPerLine !== undefined) style.maxCharsPerLine = input.maxCharsPerLine

  return {
    description: `Đổi kiểu phụ đề "${track.name}"`,
    commands: [{ type: 'subtitle/set-style', trackId: track.id, style }]
  }
}

function planOverlayStyle(document: ProjectDocument, input: SetTextStyleInput): Planned {
  // Báo thẳng thay vì lặng lẽ bỏ qua: lớp vẽ chữ overlay không dùng các trường này,
  // agent tưởng đã đổi mà hình không khác gì.
  if (
    input.preset !== undefined ||
    input.shadowPx !== undefined ||
    input.maxCharsPerLine !== undefined
  ) {
    throw new Error(
      'preset, shadowPx và maxCharsPerLine chỉ dùng cho track phụ đề (subtitleTrackId)'
    )
  }

  const targets = input.overlayId
    ? document.textOverlays.filter((item) => item.id === input.overlayId)
    : document.textOverlays
  if (targets.length === 0) {
    throw new Error(
      input.overlayId
        ? `Không tìm thấy chữ overlay "${input.overlayId}"`
        : 'Dự án chưa có chữ overlay nào'
    )
  }

  // Chỉnh hộp bằng tay trên chữ đang có khung thì màu chữ vẫn theo bộ màu khung —
  // gỡ khung đi là chữ tối có thể nằm trên hộp tối. Bắt dùng `box`, thứ đặt màu
  // chữ và viền đi cùng hộp.
  if (
    input.box === undefined &&
    (input.boxColor !== undefined || input.boxOpacity !== undefined) &&
    targets.some((overlay) => overlay.frame)
  ) {
    throw new Error(
      'Chữ đang có khung — đặt box (dark/light/none) trước khi chỉnh boxColor/boxOpacity'
    )
  }

  const commands = targets.flatMap((overlay): EditorCommand[] => [
    // Chọn kiểu nền hộp (kể cả `none`) là bỏ khung, cùng một bước hoàn tác — y như ô
    // chọn nền trên giao diện. Giữ khung mà đổi màu chữ theo hộp là chữ lạc màu khung.
    ...(input.box !== undefined && overlay.frame
      ? [{ type: 'text/update' as const, overlayId: overlay.id, frame: null }]
      : []),
    {
      type: 'text/set-style',
      overlayId: overlay.id,
      style: applyCommonFields(overlay.style, input, OVERLAY_EDGE_MARGIN_PX)
    }
  ])

  return { description: `Đổi kiểu ${targets.length} Text`, commands }
}

export function planSetTextStyle(document: ProjectDocument, input: SetTextStyleInput): Planned {
  // Gọi mà không nêu gì là một bước hoàn tác rỗng, và agent tưởng mình vừa làm xong.
  if (!hasAnyField(input)) throw new Error('Chưa nêu thứ gì để đổi')
  return input.subtitleTrackId
    ? planSubtitleStyle(document, input.subtitleTrackId, input)
    : planOverlayStyle(document, input)
}
