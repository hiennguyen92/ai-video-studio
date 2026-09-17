import { useState, type JSX } from 'react'
import {
  TEXT_FRAME_PALETTES,
  TEXT_FRAME_STYLES,
  findTextFramePalette,
  type TextFrameStyle
} from '../../../../shared/domain/text-frame-catalog'
import { buildFrameImageUri } from '../../../../shared/domain/text-frame-svg-builders'
import { textFramePngUrl } from '../../../../remotion/text-frame-png-urls'
import { useLocale } from '../../i18n/use-translation'

/**
 * Lưới ảnh thu nhỏ để chọn khung nền chữ.
 *
 * Bốn chục cái tên trong một ô chọn thì phải đoán "Kraft Tag" trông ra sao. Lưới
 * cho nhìn thấy khung trước khi chọn. Ô chọn "Nền chữ" vẫn giữ: nó gọn, bàn phím
 * dùng được, và là chỗ duy nhất có nền hộp phẳng.
 *
 * Đóng sẵn: mỗi dòng chữ có một bộ ô, mở cả lưới cho từng dòng thì panel dài lê
 * thê. Chọn xong vẫn để mở, để thử liền vài khung.
 */

const tenTheoNgonNgu = (item: { nameVi: string; nameEn: string }, locale: string): string =>
  locale === 'en' ? item.nameEn : item.nameVi

/**
 * Ảnh thu nhỏ của một khung, dạng giá trị `background-image`.
 *
 * Khung vector vẽ bằng bộ màu ĐANG DÙNG của dòng chữ: đổi bộ màu thì lưới đổi
 * theo, nên người dùng thấy đúng cái sẽ ra chứ không phải một màu mặc định.
 */
function thumbnailImage(style: TextFrameStyle, paletteId: string | undefined): string | undefined {
  if (style.kind === 'image') {
    const url = textFramePngUrl(style.id)
    return url ? `url("${url}")` : undefined
  }
  const palette = (paletteId && findTextFramePalette(paletteId)) || TEXT_FRAME_PALETTES[0]
  return buildFrameImageUri(style, palette)
}

export function TextOverlayFrameThumbnailGrid({
  selectedStyleId,
  paletteId,
  label,
  onPick
}: {
  selectedStyleId: string | undefined
  paletteId: string | undefined
  /** Gắn số thứ tự vào nhãn, do component cha cấp — để còn tìm đúng lưới của dòng nào. */
  label: (base: string) => string
  onPick(styleId: string): void
}): JSX.Element {
  const { t, locale } = useLocale()
  const [open, setOpen] = useState(false)

  const groups = [
    { key: 'vector', title: t.textOverlay.frameGroup },
    { key: 'image', title: t.textOverlay.frameImageGroup }
  ] as const

  return (
    <div className="frame-thumbnail-grid">
      <button
        type="button"
        className="button button--ghost frame-thumbnail-grid__toggle"
        aria-expanded={open}
        aria-label={label(open ? t.textOverlay.frameGalleryHide : t.textOverlay.frameGalleryShow)}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? t.textOverlay.frameGalleryHide : t.textOverlay.frameGalleryShow}
      </button>

      {open &&
        groups.map((group) => (
          <div key={group.key} role="group" aria-label={label(group.title)}>
            <p className="frame-thumbnail-grid__title">{group.title}</p>
            <div className="frame-thumbnail-grid__items">
              {TEXT_FRAME_STYLES.filter((style) => style.kind === group.key).map((style) => {
                const name = tenTheoNgonNgu(style, locale)
                const selected = style.id === selectedStyleId
                return (
                  <button
                    key={style.id}
                    type="button"
                    className={`frame-thumbnail${selected ? ' frame-thumbnail--selected' : ''}`}
                    aria-label={name}
                    aria-pressed={selected}
                    title={name}
                    onClick={() => onPick(style.id)}
                  >
                    <span
                      className="frame-thumbnail__image"
                      style={{ backgroundImage: thumbnailImage(style, paletteId) }}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        ))}
    </div>
  )
}
