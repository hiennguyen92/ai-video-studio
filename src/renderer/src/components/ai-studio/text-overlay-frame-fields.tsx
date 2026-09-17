import type { JSX } from 'react'
import {
  TEXT_FRAME_DECORS,
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFrameStyle
} from '../../../../shared/domain/text-frame-catalog'
import {
  TEXT_FRAME_PADDING_SCALE_MAX,
  clampTextFramePaddingScale,
  readTextOverlayBox,
  type TextOverlay,
  type TextOverlayBox
} from '../../../../shared/domain/text-overlay-types'
import {
  DEFAULT_TEXT_FRAME_PALETTE_ID,
  useTextOverlayFrameActions
} from '../../hooks/use-text-overlay-frame-actions'
import { useLocale } from '../../i18n/use-translation'
import { TextOverlayFrameThumbnailGrid } from './text-overlay-frame-thumbnail-grid'

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

export function TextOverlayFrameFields({
  overlay,
  label
}: {
  overlay: TextOverlay
  /** Gắn số thứ tự vào nhãn, do component cha cấp — mọi ô đều cần để còn tìm được. */
  label: (base: string) => string
}): JSX.Element {
  const { t, locale } = useLocale()
  const frame = overlay.frame
  const coBoMau = frame ? findTextFrameStyle(frame.styleId)?.kind === 'vector' : false
  const { changeBackground, changePalette, changeDecor, changePadding } =
    useTextOverlayFrameActions(overlay)

  return (
    <>
      <label>
        <span className="field-row__label">{t.textOverlay.box}</span>
        <select
          value={frame?.styleId ?? readTextOverlayBox(overlay.style)}
          aria-label={label(t.textOverlay.box)}
          onChange={(event) => changeBackground(event.target.value)}
        >
          {BOXES.map((option) => (
            <option key={option.value} value={option.value}>
              {t.textOverlay[option.labelKey]}
            </option>
          ))}
          <optgroup label={t.textOverlay.frameGroup}>
            {TEXT_FRAME_STYLES.filter((style) => style.kind === 'vector').map((style) => (
              <option key={style.id} value={style.id}>
                {tenTheoNgonNgu(style, locale)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t.textOverlay.frameImageGroup}>
            {TEXT_FRAME_STYLES.filter((style) => style.kind === 'image').map((style) => (
              <option key={style.id} value={style.id}>
                {tenTheoNgonNgu(style, locale)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <TextOverlayFrameThumbnailGrid
        selectedStyleId={frame?.styleId}
        paletteId={frame?.paletteId}
        label={label}
        onPick={changeBackground}
      />

      {/*
        Hai ô dưới KHÔNG TỒN TẠI khi chưa chọn khung vector, chứ không phải bị làm
        mờ: một ô "Màu khung" khi không có khung — hoặc khi khung là ảnh màu cố
        định — là một ô không có tác dụng.
      */}
      {coBoMau && frame && (
        <label>
          <span className="field-row__label">{t.textOverlay.frameColor}</span>
          <select
            value={frame.paletteId ?? DEFAULT_TEXT_FRAME_PALETTE_ID}
            aria-label={label(t.textOverlay.frameColor)}
            onChange={(event) => changePalette(event.target.value)}
          >
            {TEXT_FRAME_PALETTES.map((palette) => (
              <option key={palette.id} value={palette.id}>
                {tenTheoNgonNgu(palette, locale)}
              </option>
            ))}
          </select>
        </label>
      )}

      {coBoMau && frame && (
        <label>
          <span className="field-row__label">{t.textOverlay.frameDecor}</span>
          <select
            value={frame.decorId ?? ''}
            aria-label={label(t.textOverlay.frameDecor)}
            onChange={(event) => changeDecor(event.target.value)}
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
      {/*
        Đệm khung theo từng chiều, cho mọi loại khung. Không tồn tại khi chưa có
        khung: nền hộp phẳng có đệm cố định riêng.
      */}
      {frame &&
        (['x', 'y'] as const).map((axis) => {
          const base = axis === 'x' ? t.textOverlay.framePaddingX : t.textOverlay.framePaddingY
          const percent = Math.round(
            clampTextFramePaddingScale(axis === 'x' ? frame.paddingScaleX : frame.paddingScaleY) *
              100
          )
          return (
            <div key={axis} className="field-row text-overlay-item__wide">
              <span className="field-row__label">{base}</span>
              <input
                type="range"
                min={0}
                max={TEXT_FRAME_PADDING_SCALE_MAX * 100}
                step={10}
                value={percent}
                aria-label={label(base)}
                onChange={(event) => changePadding(axis, Number(event.target.value) / 100)}
              />
              <span className="field-row__value">{percent}%</span>
            </div>
          )
        })}
    </>
  )
}
