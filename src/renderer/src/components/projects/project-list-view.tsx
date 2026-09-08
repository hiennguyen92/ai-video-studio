import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AspectRatio } from '../../../../shared/domain/project-document-types'
import type { ProjectSummary } from '../../../../shared/ipc/ipc-contract'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import { IconPlus, IconTrash } from '../ui/icons'
import './project-list-view.css'

/** Màn hình đầu tiên: chọn dự án để mở, hoặc tạo dự án mới. */

const ASPECT_OPTIONS: AspectRatio[] = ['16:9', '9:16', '1:1']

export function ProjectListView({
  onOpenProject
}: {
  onOpenProject(projectId: string): void
}): JSX.Element {
  const t = useT()
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9')
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async (isCancelled: () => boolean = () => false) => {
    // Bắt cả lỗi ném ra, không chỉ kết quả `ok: false`. Khi cầu nối preload hỏng,
    // `window.api` không tồn tại và lời gọi ném ngay — không bắt thì màn hình
    // đứng mãi ở "Đang tải…" mà không nói lý do.
    try {
      const result = await window.api.project.list()
      if (isCancelled()) return
      if (result.ok) setProjects(result.data)
      else setError(result.error)
    } catch (cause) {
      if (isCancelled()) return
      setProjects([])
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // Hàm async nằm ngay trong effect để thấy rõ mọi lần cập nhật state đều
    // xảy ra SAU một `await`, không phải trong thân đồng bộ của effect.
    void (async () => {
      await refresh(() => cancelled)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed || creating) return
    setCreating(true)
    try {
      const result = await window.api.project.create({ name: trimmed, aspectRatio })
      if (result.ok) onOpenProject(result.data.id)
      else setError(result.error)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      // Trong `finally` để nút không kẹt ở trạng thái vô hiệu khi có lỗi.
      setCreating(false)
    }
  }, [name, aspectRatio, creating, onOpenProject])

  const handleDelete = useCallback(
    async (project: ProjectSummary) => {
      const confirmed = window.confirm(
        interpolate(t.projects.deleteConfirm, { name: project.name })
      )
      if (!confirmed) return
      const result = await window.api.project.remove(project.id)
      if (result.ok) void refresh()
      else setError(result.error)
    },
    [refresh, t.projects.deleteConfirm]
  )

  return (
    <div className="project-list">
      <div className="project-list__panel">
        <header className="project-list__header">
          <h1 className="project-list__title">{t.app.name}</h1>
          <p className="project-list__subtitle">{t.projects.emptyHint}</p>
        </header>

        <section className="project-list__create">
          <label className="project-list__field">
            <span className="field-row__label">{t.projects.nameLabel}</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleCreate()
              }}
              placeholder={t.projects.namePlaceholder}
              autoFocus
            />
          </label>
          <label className="project-list__field project-list__field--narrow">
            <span className="field-row__label">{t.projects.aspectLabel}</span>
            <select
              value={aspectRatio}
              onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
            >
              {ASPECT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <ToolButton
            label={t.projects.create}
            icon={<IconPlus />}
            variant="primary"
            onClick={() => void handleCreate()}
            disabled={!name.trim() || creating}
          />
        </section>

        {error && <div className="notice">{interpolate(t.errors.generic, { message: error })}</div>}

        <section className="project-list__items">
          {projects === null && <p className="project-list__loading">{t.app.loading}</p>}

          {projects?.length === 0 && (
            <EmptyState title={t.projects.empty} hint={t.projects.emptyHint} />
          )}

          {projects?.map((project) => (
            <article key={project.id} className="project-card">
              <button
                type="button"
                className="project-card__open"
                onClick={() => onOpenProject(project.id)}
              >
                <span className="project-card__name">{project.name}</span>
                <span className="project-card__meta">
                  {interpolate(t.projects.updatedAt, {
                    time: new Date(project.updatedAt).toLocaleString()
                  })}
                </span>
              </button>
              <ToolButton
                label={t.projects.delete}
                icon={<IconTrash />}
                variant="danger"
                iconOnly
                onClick={() => void handleDelete(project)}
              />
            </article>
          ))}
        </section>
      </div>
    </div>
  )
}
