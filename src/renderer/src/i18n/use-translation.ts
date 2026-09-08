import { useContext } from 'react'
import type { Dictionary } from './dictionary-vi'
import { LocaleContext, type LocaleContextValue } from './locale-context'

/** Hook đọc ngôn ngữ hiện tại. Đặt ở file riêng, không kèm component nào. */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) throw new Error('useLocale phải được dùng bên trong <LocaleProvider>')
  return context
}

/** Lối tắt cho trường hợp phổ biến nhất: chỉ cần từ điển. */
export function useT(): Dictionary {
  return useLocale().t
}

export { AVAILABLE_LOCALES, interpolate, type LocaleCode } from './locale-context'
