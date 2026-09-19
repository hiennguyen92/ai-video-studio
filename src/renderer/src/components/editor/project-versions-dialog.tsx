import { useCallback, useEffect, useState, type JSX } from 'react'
import type { ProjectVersionSummary } from '../../../../shared/ipc/project-version-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { restoreProjectVersion } from '../../state/project-version-actions'
import { interpolate, useLocale, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import '../export/export-dialog.css'

/**
 * Danh sách bản chụp phiên bản của dự án, và nút khôi phục.
 *
 * Khôi phục cần bấm HAI lần (lần hai trên chính dòng đó): nó thay cả phiên làm
 * việc, và một cú bấm trượt tay không được phép làm chuyện đó. Hộp thoại xác
 * nhận của hệ thống thì chặn cả cửa sổ và tách câu hỏi khỏi dòng đang hỏi.
 */
export function ProjectVersionsDialog({ onClose }: { onClose(): void }): JSX.Element {
  const t = useT()
  const { locale } = useLocale()
  const projectId = useEditorStore((state) => state.session?.document.id)
  const [versions, setVersions] = useState<ProjectVersionSummary[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!projectId) return
    const result = await window.api.project.listVersions(projectId)
    if (result.ok) setVersions(result.data)
    else setNotice(result.error)
  }, [projectId])

  // Nạp lần đầu. Bỏ kết quả nếu hộp thoại đã đóng trước khi đĩa trả lời.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void window.api.project.listVersions(projectId).then((result) => {
      if (cancelled) return
      if (result.ok) setVersions(result.data)
      else setNotice(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const saveNow = async (): Promise<void> => {
    const document = useEditorStore.getState().session?.document
    if (!document) return
    setBusy(true)
    const result = await window.api.project.snapshot(document, 'manual')
    setBusy(false)
    setNotice(result.ok ? t.versions.savedNow : result.error)
    await refresh()
  }

  const restore = async (fileName: string): Promise<void> => {
    setBusy(true)
    const result = await restoreProjectVersion(fileName)
    setBusy(false)
    setConfirming(null)
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    if (result.missingMedia.length > 0) {
      setNotice(interpolate(t.versions.restoredMissing, { count: result.missingMedia.length }))
      await refresh()
      return
    }
    onClose()
  }

  const reasonLabel: Record<ProjectVersionSummary['reason'], string> = {
    auto: t.versions.reasonAuto,
    manual: t.versions.reasonManual,
    'before-restore': t.versions.reasonBeforeRestore
  }

  return (
    <div
      className="export-dialog__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.versions.title}
    >
      <div className="export-dialog">
        <header className="export-dialog__header">
          <h2>{t.versions.title}</h2>
          <ToolButton label={t.common.close} onClick={onClose} disabled={busy} />
        </header>

        <div className="export-dialog__body">
          <p className="dialog-note">{t.versions.hint}</p>
          {notice && (
            <p className="dialog-note dialog-note--strong" role="status">
              {notice}
            </p>
          )}

          {versions && versions.length === 0 && (
            <EmptyState title={t.versions.empty} hint={t.versions.emptyHint} />
          )}

          <ul className="project-versions__list">
            {versions?.map((version) => (
              <li key={version.fileName} className="project-versions__item">
                <div className="project-versions__meta">
                  <span className="project-versions__time">
                    {new Date(version.savedAt).toLocaleString(locale)}
                  </span>
                  <span className="project-versions__detail">
                    {reasonLabel[version.reason]} ·{' '}
                    {interpolate(t.versions.summary, {
                      clips: version.clipCount,
                      duration: formatClockTime(version.durationUs, false)
                    })}
                  </span>
                </div>
                <ToolButton
                  label={
                    confirming === version.fileName ? t.versions.confirmRestore : t.versions.restore
                  }
                  variant={confirming === version.fileName ? 'danger' : 'outline'}
                  disabled={busy}
                  onClick={() =>
                    confirming === version.fileName
                      ? void restore(version.fileName)
                      : setConfirming(version.fileName)
                  }
                />
              </li>
            ))}
          </ul>
        </div>

        <footer className="export-dialog__footer">
          <ToolButton
            label={t.versions.saveNow}
            variant="primary"
            disabled={busy}
            onClick={() => void saveNow()}
          />
        </footer>
      </div>
    </div>
  )
}
