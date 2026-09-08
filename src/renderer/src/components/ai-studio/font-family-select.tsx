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

export function FontFamilySelect({
  value,
  onChange
}: {
  value: string
  /** `fontFilePath` chỉ có khi chép được byte font ra kho. */
  onChange(next: { fontFamily: string; fontFilePath?: string }): void
}): JSX.Element {
  const t = useT()
  const { families, loading, readFontBytes } = useSystemFonts()
  const [saving, setSaving] = useState(false)

  const handlePick = useCallback(
    async (family: string) => {
      // Đổi tên họ TRƯỚC: preview phải phản hồi ngay, không chờ chép file.
      onChange({ fontFamily: family })

      setSaving(true)
      try {
        const bytes = await readFontBytes(family)
        if (!bytes) return
        const stored = await window.api.fonts.store(family, bytes)
        if (stored.ok) onChange({ fontFamily: family, fontFilePath: stored.data.path })
      } finally {
        setSaving(false)
      }
    },
    [onChange, readFontBytes]
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
        <select
          value={value}
          aria-label={t.subtitles.fontFamily}
          onChange={(event) => void handlePick(event.target.value)}
        >
          {/* Font đang dùng có thể không nằm trong danh sách của máy này — dự án
              mở từ máy khác chẳng hạn. Vẫn phải hiện ra, không được nuốt mất. */}
          {!families.includes(value) && <option value={value}>{value}</option>}
          {families.map((family) => (
            <option key={family} value={family}>
              {family}
            </option>
          ))}
        </select>
      )}

      {saving && <span className="field-row__value">{t.subtitles.fontSaving}</span>}
    </div>
  )
}
