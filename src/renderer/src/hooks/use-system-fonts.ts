import { useCallback, useEffect, useState } from 'react'

/**
 * Danh sách font ĐANG CÓ trên máy này.
 *
 * Đọc thật qua Local Font Access API thay vì bày một danh sách viết cứng: danh
 * sách viết cứng sẽ chứa font mà máy người dùng không có, và khi chọn phải nó thì
 * chữ lặng lẽ rơi về font mặc định — đúng kiểu "bày ra tuỳ chọn không hoạt động"
 * mà DESCRIPTION §3.B cấm.
 *
 * Trả về `null` khi trình duyệt không cho phép hoặc không hỗ trợ. Nơi gọi phải
 * nói ra điều đó, không được im lặng hiện một danh sách rỗng.
 */

interface LocalFontData {
  family: string
  fullName: string
  postscriptName: string
  blob(): Promise<Blob>
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

export interface SystemFonts {
  /** Tên họ font, đã khử trùng lặp và sắp xếp. `null` nghĩa là không đọc được. */
  families: string[] | null
  loading: boolean
  /** Lấy byte của một họ font, để lưu lại cho việc nung phụ đề. */
  readFontBytes(family: string): Promise<Uint8Array | null>
}

export function useSystemFonts(): SystemFonts {
  const [families, setFamilies] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const query = window.queryLocalFonts
        if (!query) {
          if (!cancelled) setFamilies(null)
          return
        }
        const fonts = await query()
        if (cancelled) return
        setFamilies([...new Set(fonts.map((font) => font.family))].sort())
      } catch {
        // Người dùng từ chối quyền, hoặc nền tảng không hỗ trợ.
        if (!cancelled) setFamilies(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const readFontBytes = useCallback(async (family: string): Promise<Uint8Array | null> => {
    try {
      const query = window.queryLocalFonts
      if (!query) return null

      const fonts = await query()
      // Lấy kiểu thường của họ đó. Chọn nhầm bản nghiêng hay đậm thì bản nung
      // trông khác hẳn preview, vốn dùng kiểu thường rồi tự làm đậm bằng CSS.
      const candidates = fonts.filter((font) => font.family === family)
      const regular =
        candidates.find((font) => /regular|book/i.test(font.fullName)) ?? candidates[0]
      if (!regular) return null

      return new Uint8Array(await (await regular.blob()).arrayBuffer())
    } catch {
      return null
    }
  }, [])

  return { families, loading, readFontBytes }
}
