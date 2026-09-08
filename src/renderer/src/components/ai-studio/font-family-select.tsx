import { useCallback, useState, type JSX } from 'react'
import { useSystemFonts } from '../../hooks/use-system-fonts'
import { useT } from '../../i18n/use-translation'

/**
 * Ô chọn font, dùng chung cho phụ đề và chữ đè lên hình.
 *
 * Chọn font làm HAI việc, không phải một:
 *
 *   1. đặt tên họ font — đủ cho preview, vì Chromium vẽ được font hệ thống
 *   2. chép byte của font ra kho riêng — bắt buộc cho bản NUNG phụ đề, vì libass
 *      của ffmpeg tra font qua fontconfig và có thể không thấy font hệ thống;
 *      không thấy thì nó lặng lẽ đổi sang font mặc định
 *
 * Bước 2 chạy nền và không chặn bước 1: preview đổi ngay, còn file font chỉ cần
 * có mặt lúc xuất.
 */

export interface FontSelection {
  fontFamily: string
  fontPostScriptName?: string
  /** Chỉ có khi chép được byte font ra kho. */
  fontFilePath?: string
}

export function FontFamilySelect({
  family,
  postScriptName,
  onChange
}: {
  family: string
  postScriptName?: string
  onChange(next: FontSelection): void
}): JSX.Element {
  const t = useT()
  const { families, loading, facesOf, readFontBytes } = useSystemFonts()
  const [saving, setSaving] = useState(false)

  const faces = facesOf(family)

  const apply = useCallback(
    async (nextFamily: string, nextPostScript: string | undefined) => {
      // Đổi tên TRƯỚC: preview phải phản hồi ngay, không chờ chép file.
      onChange({ fontFamily: nextFamily, fontPostScriptName: nextPostScript })
      if (!nextPostScript) return

      setSaving(true)
      try {
        const bytes = await readFontBytes(nextPostScript)
        if (!bytes) return
        const stored = await window.api.fonts.store(nextPostScript, bytes)
        if (stored.ok) {
          onChange({
            fontFamily: nextFamily,
            fontPostScriptName: nextPostScript,
            fontFilePath: stored.data.path
          })
        }
      } finally {
        setSaving(false)
      }
    },
    [onChange, readFontBytes]
  )

  const handlePickFamily = useCallback(
    (nextFamily: string) => {
      // Đổi họ thì chọn luôn một kiểu của họ đó: giữ kiểu cũ là giữ một tên
      // PostScript thuộc họ khác, và chữ sẽ không đổi gì cả.
      const nextFaces = facesOf(nextFamily)
      const preferred = nextFaces.find((face) => /^regular$/i.test(face.style)) ?? nextFaces[0]
      void apply(nextFamily, preferred?.postScriptName)
    },
    [apply, facesOf]
  )

  return (
    <div className="field-row">
      <span className="field-row__label">{t.subtitles.fontFamily}</span>

      {families === null ? (
        // Nói ra thay vì hiện một ô rỗng: người dùng cần biết vì sao không chọn được.
        <span className="field-row__value">
          {loading ? t.subtitles.fontLoading : t.subtitles.fontUnavailable}
        </span>
      ) : (
        <>
          <select
            value={family}
            aria-label={t.subtitles.fontFamily}
            onChange={(event) => handlePickFamily(event.target.value)}
          >
            {/* Font đang dùng có thể không nằm trong danh sách của máy này — dự án
                mở từ máy khác chẳng hạn. Vẫn phải hiện ra, không được nuốt mất. */}
            {!families.includes(family) && <option value={family}>{family}</option>}
            {families.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>

          {/* Họ chỉ có một kiểu thì ô chọn kiểu là một ô chỉ có một lựa chọn. */}
          {faces.length > 1 && (
            <select
              value={postScriptName ?? faces[0].postScriptName}
              aria-label={t.subtitles.fontStyle}
              onChange={(event) => void apply(family, event.target.value)}
            >
              {faces.map((face) => (
                <option key={face.postScriptName} value={face.postScriptName}>
                  {face.style}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {saving && <span className="field-row__value">{t.subtitles.fontSaving}</span>}
    </div>
  )
}
