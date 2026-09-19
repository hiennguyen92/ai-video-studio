import { useState, type JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { FrameRate } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Lưu khung hình tại đầu phát ra PNG — ảnh bìa để đăng.
 *
 * Cùng độ phân giải với lựa chọn xuất video, và dựng bằng cùng composition, nên
 * ảnh bìa khớp đúng từng điểm ảnh với khung tương ứng trong video.
 */
export function ExportStillButton({
  document,
  size,
  frameRate,
  disabled
}: {
  document: ProjectDocument
  size: { width: number; height: number }
  frameRate: FrameRate
  disabled: boolean
}): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    const safeName = document.name.replace(/[/\\:*?"<>|]/g, '-')
    const picked = await window.api.export.pickOutputPath(`${safeName}.png`, 'image')
    if (!picked.ok) {
      setNotice(picked.error)
      return
    }
    if (!picked.data) return

    setBusy(true)
    setNotice(null)
    const result = await window.api.export.still({
      document,
      // Đầu phát đọc lúc bấm: đó là khung người dùng đang nhìn.
      atUs: useEditorStore.getState().playheadUs,
      width: size.width,
      height: size.height,
      frameRate,
      outputPath: picked.data
    })
    setBusy(false)
    setNotice(result.ok ? interpolate(t.export.stillSaved, { path: result.data }) : result.error)
  }

  return (
    <>
      <ToolButton
        label={busy ? t.export.stillWorking : t.export.still}
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void save()}
      />
      {notice && (
        <p className="dialog-note" role="status">
          {notice}
        </p>
      )}
    </>
  )
}
