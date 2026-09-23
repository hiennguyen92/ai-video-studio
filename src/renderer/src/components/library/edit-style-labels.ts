import type { EditStyle } from '../../../../shared/domain/edit-style-catalog'
import type { Dictionary } from '../../i18n/dictionary-vi'

/** Chỉ những khoá có giá trị là CHUỖI — `library` còn chứa cụm `tabs` lồng bên trong. */
type LibraryKey = {
  [Key in keyof Dictionary['library']]: Dictionary['library'][Key] extends string ? Key : never
}[keyof Dictionary['library']]

/**
 * Khoá nhãn của từng kiểu dựng.
 *
 * `Record` theo id nên thêm một kiểu dựng mà quên nhãn là TypeScript báo ngay —
 * cùng lối với `TRANSITION_LABEL_KEYS`.
 */
export const EDIT_STYLE_LABEL_KEYS: Record<
  EditStyle['id'],
  { name: LibraryKey; note: LibraryKey }
> = {
  'vertical-short': { name: 'editStyleVerticalShort', note: 'editStyleVerticalShortNote' },
  cinematic: { name: 'editStyleCinematic', note: 'editStyleCinematicNote' },
  tutorial: { name: 'editStyleTutorial', note: 'editStyleTutorialNote' },
  'repurpose-vertical': {
    name: 'editStyleRepurposeVertical',
    note: 'editStyleRepurposeVerticalNote'
  },
  'travel-vlog': { name: 'editStyleTravelVlog', note: 'editStyleTravelVlogNote' },
  trailer: { name: 'editStyleTrailer', note: 'editStyleTrailerNote' },
  'retro-film': { name: 'editStyleRetroFilm', note: 'editStyleRetroFilmNote' },
  'photo-slideshow': { name: 'editStylePhotoSlideshow', note: 'editStylePhotoSlideshowNote' }
}
