import { useCallback, useMemo, useState, type JSX, type ReactNode } from 'react'
import {
  DICTIONARIES,
  LOCALE_STORAGE_KEY,
  LocaleContext,
  readStoredLocale,
  type LocaleCode,
  type LocaleContextValue
} from './locale-context'

/**
 * i18n tối giản, tự viết.
 *
 * Vì sao không dùng i18next: ứng dụng chỉ có hai ngôn ngữ, không cần số nhiều
 * phức tạp hay tải từ điển từ xa. Đổi lại, cách này cho phép truy cập chuỗi
 * theo kiểu `t.timeline.split` — gõ sai khoá là lỗi biên dịch, và bản tiếng Anh
 * thiếu chuỗi cũng là lỗi biên dịch. i18next dùng khoá chuỗi nên cả hai lỗi đó
 * chỉ lộ ra lúc chạy.
 */
export function LocaleProvider({ children }: { children: ReactNode }): JSX.Element {
  const [locale, setLocaleState] = useState<LocaleCode>(readStoredLocale)

  const setLocale = useCallback((next: LocaleCode) => {
    setLocaleState(next)
    document.documentElement.lang = next
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      // Không lưu được thì vẫn đổi ngôn ngữ cho phiên hiện tại.
    }
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, t: DICTIONARIES[locale], setLocale }),
    [locale, setLocale]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}
