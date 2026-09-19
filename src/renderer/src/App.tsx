import { useCallback, useEffect, useState, type JSX } from 'react'
import { LocaleProvider } from './i18n/locale-provider'
import { ProjectListView } from './components/projects/project-list-view'
import { EditorWorkspace } from './components/editor/editor-workspace'
import { useEditorStore } from './state/editor-store'
import { flushPendingSave } from './state/project-save-queue'
import { TooltipLayer } from './components/ui/tooltip-layer'
import { interpolate, useT } from './i18n/use-translation'

/**
 * Gốc ứng dụng.
 *
 * Chỉ có hai màn hình nên dùng một biến state thay vì kéo cả router về: thêm
 * router chỉ để chuyển qua lại hai màn hình là công cụ thừa.
 */
function AppRoutes(): JSX.Element {
  const [projectId, setProjectId] = useState<string | null>(null)
  const closeProject = useEditorStore((state) => state.closeProject)
  const t = useT()

  // Cửa sổ sắp đóng: ghi nốt sửa đổi đang chờ. Main đợi tín hiệu xong mới đóng.
  useEffect(
    () =>
      window.api.app.onFlushBeforeClose(async () => {
        const saved = await flushPendingSave()
        if (saved.ok) return true
        // Ghi hỏng: hỏi, như lúc về danh sách dự án — đóng lặng lẽ là mất sửa đổi.
        return window.confirm(interpolate(t.app.saveFailedClose, { error: saved.error }))
      }),
    [t]
  )

  const handleBack = useCallback(async () => {
    // Ghi sửa đổi đang chờ autosave TRƯỚC khi đóng dự án — không thì sửa đổi trong
    // 1,2 s cuối biến mất cùng bộ hẹn giờ.
    const saved = await flushPendingSave()
    if (!saved.ok && !window.confirm(interpolate(t.app.saveFailedLeave, { error: saved.error }))) {
      return
    }
    closeProject()
    setProjectId(null)
  }, [closeProject, t])

  if (!projectId) {
    return <ProjectListView onOpenProject={setProjectId} />
  }

  // `key` bắt React dựng lại toàn bộ workspace khi đổi dự án, nên không còn
  // state cũ (vùng chọn, playhead, phần tử media) sót lại từ dự án trước.
  return (
    <EditorWorkspace
      key={projectId}
      projectId={projectId}
      onBackToProjects={() => void handleBack()}
    />
  )
}

export default function App(): JSX.Element {
  return (
    <LocaleProvider>
      <AppRoutes />
      <TooltipLayer />
    </LocaleProvider>
  )
}
