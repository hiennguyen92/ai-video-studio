import { useEffect, useState, type JSX } from 'react'
import type { JobRecord } from '../../../../shared/jobs/job-types'
import { isJobActive } from '../../../../shared/jobs/job-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import './job-activity-indicator.css'

/**
 * Chỉ báo tác vụ nền trên thanh công cụ.
 *
 * Job chạy ở tiến trình main nên vẫn tiếp tục khi người dùng chuyển tab; chỉ báo
 * này là chỗ duy nhất nhìn thấy chúng từ mọi màn hình, và là chỗ huỷ được.
 *
 * Chỉ hiện phần trăm khi backend báo tiến trình thật; còn lại là trạng thái vô
 * định (DESCRIPTION §6).
 */
export function JobActivityIndicator(): JSX.Element | null {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const projectId = document?.id
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false

    void (async () => {
      const result = await window.api.jobs.list(projectId)
      if (!cancelled && result.ok) setJobs(result.data)
    })()

    const unsubscribe = window.api.jobs.onChanged((job) => {
      // Job của project khác vẫn chạy nhưng không hiển thị ở đây.
      if (job.projectId !== projectId) return
      setJobs((current) => {
        const index = current.findIndex((item) => item.id === job.id)
        if (index < 0) return [...current, job]
        const next = [...current]
        next[index] = job
        return next
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [projectId])

  const active = jobs.filter(isJobActive)
  if (jobs.length === 0) return null

  const statusLabel = (job: JobRecord): string =>
    job.status === 'queued'
      ? t.jobs.queued
      : job.status === 'running'
        ? t.jobs.running
        : job.status === 'succeeded'
          ? t.jobs.succeeded
          : job.status === 'failed'
            ? t.jobs.failed
            : t.jobs.cancelled

  return (
    <div className="job-activity">
      <button
        type="button"
        className={`job-activity__trigger ${active.length > 0 ? 'job-activity__trigger--busy' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title={t.jobs.title}
        aria-expanded={open}
      >
        {active.length > 0 && <span className="job-activity__spinner" aria-hidden="true" />}
        <span>
          {t.jobs.title}
          {active.length > 0 ? ` · ${active.length}` : ''}
        </span>
      </button>

      {open && (
        <div className="job-activity__popover" role="dialog" aria-label={t.jobs.title}>
          <header className="job-activity__popover-header">
            <span>{t.jobs.title}</span>
            <ToolButton
              label={t.jobs.clearFinished}
              onClick={() => {
                if (!projectId) return
                void window.api.jobs.clearFinished(projectId)
                setJobs((current) => current.filter(isJobActive))
              }}
            />
          </header>

          {jobs.length === 0 && <p className="job-activity__empty">{t.jobs.none}</p>}

          <ul className="job-activity__list">
            {jobs.map((job) => (
              <li key={job.id} className="job-activity__item">
                <div className="job-activity__item-head">
                  <span className="job-activity__label" title={job.label}>
                    {job.label}
                  </span>
                  <span className={`job-activity__status job-activity__status--${job.status}`}>
                    {statusLabel(job)}
                  </span>
                </div>

                {job.status === 'running' && (
                  <div className="job-activity__bar">
                    <div
                      className={`job-activity__fill ${
                        job.progress.value === undefined ? 'job-activity__fill--indeterminate' : ''
                      }`}
                      style={
                        job.progress.value === undefined
                          ? undefined
                          : { width: `${Math.round(job.progress.value * 100)}%` }
                      }
                    />
                  </div>
                )}

                {job.servedFromCache && (
                  <span className="job-activity__note">{t.jobs.fromCache}</span>
                )}
                {job.error && <span className="job-activity__error">{job.error.message}</span>}

                {isJobActive(job) && (
                  <ToolButton
                    label={t.jobs.cancel}
                    variant="danger"
                    onClick={() => void window.api.jobs.cancel(job.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
