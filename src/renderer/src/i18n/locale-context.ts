import { createContext } from 'react'
import { dictionaryVi, type Dictionary } from './dictionary-vi'
import { dictionaryEn } from './dictionary-en'

/**
 * Phần "không phải component" của lớp i18n.
 *
 * Tách khỏi file chứa `LocaleProvider` để mỗi file chỉ export một loại thứ:
 * file có component thì chỉ có component. Nhờ vậy hot reload lúc phát triển
 * không phải dựng lại cả cây React mỗi khi sửa một hằng số.
 */

export type LocaleCode = 'vi' | 'en'

export const AVAILABLE_LOCALES: Array<{ code: LocaleCode; label: string }> = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' }
]

export const DICTIONARIES: Record<LocaleCode, Dictionary> = {
  vi: dictionaryVi,
  en: dictionaryEn
}

export const LOCALE_STORAGE_KEY = 'ai-video-studio.locale'

export interface LocaleContextValue {
  locale: LocaleCode
  t: Dictionary
  setLocale(locale: LocaleCode): void
}

export const LocaleContext = createContext<LocaleContextValue | null>(null)

export function readStoredLocale(): LocaleCode {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'vi' || stored === 'en') return stored
  } catch {
    // localStorage bị chặn — rơi về mặc định.
  }
  // Tiếng Việt LUÔN là mặc định, không phụ thuộc ngôn ngữ hệ điều hành: đây là
  // ứng dụng hướng người dùng Việt, tiếng Anh là lựa chọn thêm. Suy ra ngôn ngữ
  // từ hệ thống sẽ khiến máy đặt tiếng Anh mở lên thành giao diện tiếng Anh.
  return 'vi'
}

/** Thay chỗ giữ chỗ dạng {name} trong chuỗi đã dịch. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  )
}
