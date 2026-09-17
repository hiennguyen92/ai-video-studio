import {
  TEXT_FRAME_PALETTES,
  findTextFramePalette,
  findTextFrameStyle
} from '../../../shared/domain/text-frame-catalog'
import {
  applyTextOverlayBox,
  applyTextOverlayFrame,
  clampTextFramePaddingScale,
  type TextOverlay,
  type TextOverlayBox
} from '../../../shared/domain/text-overlay-types'
import { useEditorStore } from '../state/editor-store'

/** Bộ màu mặc định khi vừa bật khung vector: chọn khung xong phải thấy ngay một cái khung. */
export const DEFAULT_TEXT_FRAME_PALETTE_ID = TEXT_FRAME_PALETTES[0].id

/**
 * Ba thao tác đổi nền chữ, dùng chung cho ô chọn và lưới ảnh thu nhỏ.
 *
 * Tách khỏi component để hai lối chọn không chép logic làm hai bản: lệch nhau ở
 * đây nghĩa là cùng một khung mà chọn từ lưới ra màu chữ khác chọn từ ô chọn.
 */
export function useTextOverlayFrameActions(overlay: TextOverlay): {
  changeBackground(value: string): void
  changePalette(paletteId: string): void
  changeDecor(decorId: string): void
  changePadding(axis: 'x' | 'y', scale: number): void
} {
  const run = useEditorStore((state) => state.run)
  const frame = overlay.frame
  // Đổi kiểu khung GIỮ độ rộng người dùng đã chỉnh: thử khung khác mà khung bó
  // sát trở lại mặc định là phải kéo lại từ đầu.
  const padding = {
    ...(frame?.paddingScaleX !== undefined ? { paddingScaleX: frame.paddingScaleX } : {}),
    ...(frame?.paddingScaleY !== undefined ? { paddingScaleY: frame.paddingScaleY } : {})
  }

  /**
   * Đổi nền là ghi vào HAI chỗ: `frame` trên overlay và màu chữ trong `style`.
   * Hai lệnh nằm trong MỘT `run` nên chỉ tốn một bước hoàn tác — nếu tách ra thì
   * người dùng phải nhấn Cmd+Z hai lần mới bỏ được khung, nhìn ra như lỗi.
   *
   * `value` là id khung, hoặc một kiểu nền hộp phẳng (`none` | `dark` | `light`).
   */
  const changeBackground = (value: string): void => {
    const style = findTextFrameStyle(value)
    if (!style) {
      // `frame: null` chứ không phải bỏ trống: bỏ trống nghĩa là "giữ nguyên", và
      // nút tắt khung sẽ không tắt được.
      run(
        [
          { type: 'text/update', overlayId: overlay.id, frame: null },
          {
            type: 'text/set-style',
            overlayId: overlay.id,
            style: applyTextOverlayBox(overlay.style, value as TextOverlayBox)
          }
        ],
        'Đổi nền chữ'
      )
      return
    }

    if (style.kind === 'image') {
      // Khung ảnh không mang bộ màu hay trang trí: màu đã vẽ sẵn trong ảnh.
      run(
        [
          {
            type: 'text/update',
            overlayId: overlay.id,
            frame: { styleId: style.id, ...padding }
          },
          {
            type: 'text/set-style',
            overlayId: overlay.id,
            style: applyTextOverlayFrame(overlay.style, { text: style.textColor })
          }
        ],
        'Đổi khung chữ'
      )
      return
    }

    const paletteId = frame?.paletteId ?? DEFAULT_TEXT_FRAME_PALETTE_ID
    const palette = findTextFramePalette(paletteId) ?? TEXT_FRAME_PALETTES[0]
    run(
      [
        {
          type: 'text/update',
          overlayId: overlay.id,
          frame: {
            styleId: style.id,
            paletteId: palette.id,
            decorId: frame?.decorId,
            ...padding
          }
        },
        {
          type: 'text/set-style',
          overlayId: overlay.id,
          style: applyTextOverlayFrame(overlay.style, palette)
        }
      ],
      'Đổi khung chữ'
    )
  }

  const changePalette = (paletteId: string): void => {
    if (!frame) return
    const palette = findTextFramePalette(paletteId)
    if (!palette) return
    run(
      [
        { type: 'text/update', overlayId: overlay.id, frame: { ...frame, paletteId } },
        {
          type: 'text/set-style',
          overlayId: overlay.id,
          style: applyTextOverlayFrame(overlay.style, palette)
        }
      ],
      'Đổi màu khung'
    )
  }

  const changeDecor = (decorId: string): void => {
    if (!frame) return
    run(
      [
        {
          type: 'text/update',
          overlayId: overlay.id,
          frame: {
            styleId: frame.styleId,
            paletteId: frame.paletteId,
            decorId: decorId || undefined,
            ...padding
          }
        }
      ],
      'Đổi trang trí khung'
    )
  }

  const changePadding = (axis: 'x' | 'y', scale: number): void => {
    if (!frame) return
    const key = axis === 'x' ? 'paddingScaleX' : 'paddingScaleY'
    run(
      [
        {
          type: 'text/update',
          overlayId: overlay.id,
          frame: { ...frame, [key]: clampTextFramePaddingScale(scale) }
        }
      ],
      axis === 'x' ? 'Đổi đệm ngang khung' : 'Đổi đệm dọc khung'
    )
  }

  return { changeBackground, changePalette, changeDecor, changePadding }
}
