import type { JSX } from 'react'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFramePalette
} from '../../../../shared/domain/text-frame-catalog'
import {
  applyTextOverlayBox,
  applyTextOverlayFrame,
  readTextOverlayBox,
  type TextOverlay,
  type TextOverlayBox
} from '../../../../shared/domain/text-overlay-types'
import { useEditorStore } from '../../state/editor-store'
import { useLocale } from '../../i18n/use-translation'

/**
 * Ba ô liên quan tới nền chữ.
 *
 * Ô "Nền chữ" gộp CẢ nền hộp phẳng lẫn khung dễ thương vào một danh sách. Hai thứ
 * đó cùng vẽ nền sau chữ, nên bày thành hai ô rời là mời người dùng bật cả hai
 * rồi tự hỏi vì sao có hình chữ nhật xám nằm trong cái mây. Gộp lại thì chúng
 * loại trừ nhau THEO CẤU TRÚC, không theo lời dặn — và nó khớp câu hỏi trong đầu
 * người dùng, vốn chỉ có một: "sau chữ tôi có cái gì".
 *
 * Ba mục cũ giữ nguyên tên và nguyên `value`: đổi chúng sẽ làm đỏ một phép thử
 * đầu-cuối không liên quan gì tới khung.
 */

/** Tên theo ngôn ngữ đang chọn. Danh mục mang sẵn cả hai, theo mẫu thư viện âm thanh. */
const tenTheoNgonNgu = (item: { nameVi: string; nameEn: string }, locale: string): string =>
  locale === 'en' ? item.nameEn : item.nameVi

const BOXES: Array<{ value: TextOverlayBox; labelKey: 'boxNone' | 'boxDark' | 'boxLight' }> = [
  { value: 'none', labelKey: 'boxNone' },
  { value: 'dark', labelKey: 'boxDark' },
  { value: 'light', labelKey: 'boxLight' }
]

/** Bộ màu mặc định khi vừa bật khung: chọn khung xong phải thấy ngay một cái khung. */
const PALETTE_MAC_DINH = TEXT_FRAME_PALETTES[0].id

export function TextOverlayFrameFields({
  overlay,
  label
}: {
  overlay: TextOverlay
  /** Gắn số thứ tự vào nhãn, do component cha cấp — mọi ô đều cần để còn tìm được. */
  label: (base: string) => string
}): JSX.Element {
  const { t, locale } = useLocale()
  const run = useEditorStore((state) => state.run)
  const frame = overlay.frame

  /**
   * Đổi nền là ghi vào HAI chỗ: `frame` trên overlay và màu chữ trong `style`.
   * Hai lệnh nằm trong MỘT `run` nên chỉ tốn một bước hoàn tác — nếu tách ra thì
   * người dùng phải nhấn Cmd+Z hai lần mới bỏ được khung, nhìn ra như lỗi.
   */
  const doiNen = (value: string): void => {
    const style = TEXT_FRAME_STYLES.find((item) => item.id === value)
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

    const paletteId = frame?.paletteId ?? PALETTE_MAC_DINH
    const palette = findTextFramePalette(paletteId) ?? TEXT_FRAME_PALETTES[0]
    run(
      [
        {
          type: 'text/update',
          overlayId: overlay.id,
          frame: { styleId: style.id, paletteId: palette.id, decorId: frame?.decorId }
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

  const doiMau = (paletteId: string): void => {
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

  const doiTrangTri = (decorId: string): void => {
    if (!frame) return
    run(
      [
        {
          type: 'text/update',
          overlayId: overlay.id,
          frame: {
            styleId: frame.styleId,
            paletteId: frame.paletteId,
            decorId: decorId || undefined
          }
        }
      ],
      'Đổi trang trí khung'
    )
  }

  return (
    <>
      <label>
        <span className="field-row__label">{t.textOverlay.box}</span>
        <select
          value={frame?.styleId ?? readTextOverlayBox(overlay.style)}
          aria-label={label(t.textOverlay.box)}
          onChange={(event) => doiNen(event.target.value)}
        >
          {BOXES.map((option) => (
            <option key={option.value} value={option.value}>
              {t.textOverlay[option.labelKey]}
            </option>
          ))}
          <optgroup label={t.textOverlay.frameGroup}>
            {TEXT_FRAME_STYLES.map((style) => (
              <option key={style.id} value={style.id}>
                {tenTheoNgonNgu(style, locale)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      {/*
        Hai ô dưới KHÔNG TỒN TẠI khi chưa chọn khung, chứ không phải bị làm mờ:
        một ô "Màu khung" khi không có khung là một ô không có tác dụng.
      */}
      {frame && (
        <label>
          <span className="field-row__label">{t.textOverlay.frameColor}</span>
          <select
            value={frame.paletteId}
            aria-label={label(t.textOverlay.frameColor)}
            onChange={(event) => doiMau(event.target.value)}
          >
            {TEXT_FRAME_PALETTES.map((palette) => (
              <option key={palette.id} value={palette.id}>
                {tenTheoNgonNgu(palette, locale)}
              </option>
            ))}
          </select>
        </label>
      )}

      {frame && (
        <label>
          <span className="field-row__label">{t.textOverlay.frameDecor}</span>
          <select
            value={frame.decorId ?? ''}
            aria-label={label(t.textOverlay.frameDecor)}
            onChange={(event) => doiTrangTri(event.target.value)}
          >
            <option value="">{t.textOverlay.frameDecorNone}</option>
            {TEXT_FRAME_DECORS.map((decor) => (
              <option key={decor.id} value={decor.id}>
                {tenTheoNgonNgu(decor, locale)}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
