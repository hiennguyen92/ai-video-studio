import { useCallback, useEffect, useMemo, useState } from 'react'

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
  style: string
  blob(): Promise<Blob>
}

export interface FontFace {
  /** Nhãn hiện cho người dùng, ví dụ "Bold", "Condensed Light". */
  style: string
  /** Khoá chọn ĐÚNG kiểu này, dùng cho cả CSS lẫn dòng Style của ASS. */
  postScriptName: string
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
  /** Các kiểu có trong một họ. Rỗng khi họ đó không đọc được. */
  facesOf(family: string): FontFace[]
  /** Lấy byte của ĐÚNG kiểu đã chọn, để lưu lại cho việc nung phụ đề. */
  readFontBytes(postScriptName: string): Promise<Uint8Array | null>
}

export function useSystemFonts(): SystemFonts {
  const [byFamily, setByFamily] = useState<Map<string, FontFace[]> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const query = window.queryLocalFonts
        if (!query) {
          if (!cancelled) setByFamily(null)
          return
        }
        const fonts = await query()
        if (cancelled) return

        const grouped = new Map<string, FontFace[]>()
        for (const font of fonts) {
          const faces = grouped.get(font.family) ?? []
          faces.push({ style: font.style, postScriptName: font.postscriptName })
          grouped.set(font.family, faces)
        }
        for (const faces of grouped.values()) {
          faces.sort((left, right) => left.style.localeCompare(right.style))
        }
        setByFamily(grouped)
      } catch {
        // Người dùng từ chối quyền, hoặc nền tảng không hỗ trợ.
        if (!cancelled) setByFamily(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const families = useMemo(() => (byFamily ? [...byFamily.keys()].sort() : null), [byFamily])

  const facesOf = useCallback(
    (family: string): FontFace[] => byFamily?.get(family) ?? [],
    [byFamily]
  )

  const readFontBytes = useCallback(async (postScriptName: string): Promise<Uint8Array | null> => {
    try {
      const query = window.queryLocalFonts
      if (!query) return null

      const fonts = await query()
      // Lấy ĐÚNG kiểu đã chọn. Lấy nhầm kiểu khác thì bản nung trông khác hẳn
      // preview, mà cả hai vẫn "chạy" nên chẳng có gì báo lỗi.
      const face = fonts.find((font) => font.postscriptName === postScriptName)
      if (!face) return null

      return new Uint8Array(await (await face.blob()).arrayBuffer())
    } catch {
      return null
    }
  }, [])

  return { families, loading, facesOf, readFontBytes }
}
