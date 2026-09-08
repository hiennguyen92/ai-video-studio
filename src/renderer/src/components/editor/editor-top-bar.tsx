import { useCallback, type JSX } from 'react'
import {
  selectCanRedo,
  selectCanUndo,
  selectRedoLabel,
  selectUndoLabel,
  useEditorStore
} from '../../state/editor-store'
import { AVAILABLE_LOCALES, interpolate, useLocale, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { IconChevronLeft, IconExport, IconImport, IconRedo, IconSave, IconUndo } from '../ui/icons'

/** Thanh công cụ trên cùng: dự án, nhập media, hoàn tác/làm lại, lưu, xuất. */

export function EditorTopBar({
  onBackToProjects,
  onImportMedia,
  onExport,
  importing
}: {
  onBackToProjects(): void
  onImportMedia(): void
  onExport(): void
  importing: boolean
}): JSX.Element {
  const t = useT()
  const { locale, setLocale } = useLocale()

  const projectName = useEditorStore((state) => state.session?.document.name ?? '')
  const saveState = useEditorStore((state) => state.saveState)
  const lastError = useEditorStore((state) => state.lastError)
  const canUndo = useEditorStore(selectCanUndo)
  const canRedo = useEditorStore(selectCanRedo)
  const undoLabel = useEditorStore(selectUndoLabel)
  const redoLabel = useEditorStore(selectRedoLabel)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setSaveState = useEditorStore((state) => state.setSaveState)

  // "Lưu" chỉ đánh dấu dirty; việc ghi đĩa do autosave lo, nên chỉ có một đường ghi file.
  const handleSave = useCallback(() => setSaveState('dirty'), [setSaveState])

  const undoTitle = canUndo
    ? interpolate(t.topbar.undoWith, { label: undoLabel ?? '' })
    : t.topbar.nothingToUndo
  const redoTitle = canRedo
    ? interpolate(t.topbar.redoWith, { label: redoLabel ?? '' })
    : t.topbar.nothingToRedo

  const statusText =
    saveState === 'saving'
      ? t.topbar.saving
      : saveState === 'saved'
        ? t.topbar.saved
        : saveState === 'error'
          ? interpolate(t.errors.generic, { message: lastError ?? '' })
          : ''

  return (
    <header className="top-bar">
      {window.api.platform === 'darwin' && <div className="top-bar__mac-inset" />}

      <ToolButton
        label={t.projects.back}
        icon={<IconChevronLeft />}
        iconOnly
        onClick={onBackToProjects}
      />

      <span className="top-bar__title">{projectName || t.app.untitledProject}</span>

      <div className="top-bar__divider" />

      <div className="top-bar__group">
        <ToolButton
          label={t.topbar.import}
          icon={<IconImport />}
          onClick={onImportMedia}
          disabled={importing}
        />
      </div>

      <div className="top-bar__divider" />

      <div className="top-bar__group">
        <ToolButton
          label={undoTitle}
          icon={<IconUndo />}
          iconOnly
          onClick={undo}
          disabled={!canUndo}
        />
        <ToolButton
          label={redoTitle}
          icon={<IconRedo />}
          iconOnly
          onClick={redo}
          disabled={!canRedo}
        />
      </div>

      <div className="top-bar__divider" />

      <ToolButton
        label={t.topbar.save}
        icon={<IconSave />}
        onClick={handleSave}
        disabled={saveState === 'saving'}
      />

      <div className="top-bar__spacer" />

      <span
        className={`top-bar__status ${saveState === 'error' ? 'top-bar__status--error' : ''}`}
        role="status"
      >
        {statusText}
      </span>

      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as typeof locale)}
        title={t.topbar.language}
        aria-label={t.topbar.language}
      >
        {AVAILABLE_LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>

      <ToolButton
        label={t.topbar.export}
        icon={<IconExport />}
        variant="primary"
        onClick={onExport}
      />
    </header>
  )
}
