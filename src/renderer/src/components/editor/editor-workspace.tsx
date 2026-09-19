import { useCallback, useEffect, useState, type JSX } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { MissingMediaReport } from '../../../../shared/ipc/ipc-contract'
import { findFreeSlot } from '../../../../shared/commands/timeline-mutations'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { useMediaImport } from '../../hooks/use-media-import'
import { useMediaRelink } from '../../hooks/use-media-relink'
import { useProjectAutosave } from '../../hooks/use-project-autosave'
import { useMcpBridge } from '../../hooks/use-mcp-bridge'
import { useKeyboardShortcuts } from '../../hooks/use-keyboard-shortcuts'
import { interpolate, useT } from '../../i18n/use-translation'
import { AiStudioPanel } from '../ai-studio/ai-studio-panel'
import { PreviewPanel } from '../preview/preview-panel'
import { InspectorPanel } from '../inspector/inspector-panel'
import { TimelinePanel } from '../timeline/timeline-panel'
import { ExportDialog } from '../export/export-dialog'
import { ProjectVersionsDialog } from './project-versions-dialog'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { EditorTopBar } from './editor-top-bar'
import { ToolButton } from '../ui/tool-button'

/**
 * Bố cục vùng làm việc (DESCRIPTION §2).
 *
 *   Toolbar
 *   ┌───────────┬──────────────┬───────────┐
 *   │ AI Studio │   Preview    │ Inspector │
 *   └───────────┴──────────────┴───────────┘
 *   Timeline
 *
 * Panel đều kéo giãn và thu gọn được; timeline cao lên được khi cần chỉnh chi tiết.
 * Kích thước tối thiểu đặt theo phần trăm để ở 1280×720 vẫn còn dùng được.
 */

export function EditorWorkspace({
  projectId,
  onBackToProjects
}: {
  projectId: string
  onBackToProjects(): void
}): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const openProject = useEditorStore((state) => state.openProject)
  const run = useEditorStore((state) => state.run)
  const setError = useEditorStore((state) => state.setError)
  const [missingMedia, setMissingMedia] = useState<MissingMediaReport[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)

  const { importing, pickAndImport } = useMediaImport()
  const { relinking, relink } = useMediaRelink()
  useProjectAutosave()
  // Cho agent bên ngoài (Claude Code) đọc và sửa dự án đang mở qua MCP.
  useMcpBridge()
  useKeyboardShortcuts()

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const result = await window.api.project.load(projectId)
      if (cancelled) return
      if (!result.ok) {
        setLoadError(result.error)
        return
      }
      openProject(result.data)

      // Kiểm tra media còn trên đĩa không, ngay sau khi mở (DESCRIPTION §7).
      const check = await window.api.project.checkMedia(result.data)
      if (!cancelled && check.ok) setMissingMedia(check.data)
    })()

    return () => {
      cancelled = true
    }
  }, [projectId, openProject])

  /**
   * Thêm asset vào timeline mà không cần kéo thả: tìm track phù hợp rồi đặt vào
   * chỗ trống đầu tiên, để không đè lên clip đang có.
   */
  const handleAddToTimeline = useCallback(
    (asset: MediaAsset) => {
      if (!document) return
      // Ảnh ưu tiên lane ảnh, nhưng vẫn rơi về lane hình khi chưa có lane ảnh
      // nào — dự án cũ không có lane ảnh, và bấm thêm vào timeline vẫn phải chạy.
      type TimelineTrack = ProjectDocument['tracks'][number]
      const wanted: Array<(item: TimelineTrack) => boolean> =
        asset.kind === 'image'
          ? [(item) => item.kind === 'image', (item) => item.kind === 'video']
          : asset.kind === 'video'
            ? [(item) => item.kind === 'video']
            : [(item) => item.kind === 'audio']

      let track: TimelineTrack | undefined
      for (const matches of wanted) {
        track = document.tracks.find((item) => matches(item) && !item.locked)
        if (track) break
      }
      if (!track) {
        setError(t.timeline.addVideoTrack)
        return
      }

      const durationUs = asset.kind === 'image' ? 5_000_000 : asset.probe.durationUs
      if (durationUs <= 0) return

      const startUs = findFreeSlot(track.clips, 0, durationUs)
      const command: EditorCommand = {
        type: 'clip/insert',
        trackId: track.id,
        assetId: asset.id,
        startUs,
        durationUs,
        sourceInUs: 0
      }
      run([command], t.media.addToTimeline)
    },
    [document, run, setError, t.media.addToTimeline, t.timeline.addVideoTrack]
  )

  const handleExport = useCallback(() => setExportOpen(true), [])

  if (loadError) {
    return (
      <div className="app-shell">
        <div className="notice">{interpolate(t.errors.generic, { message: loadError })}</div>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <EditorTopBar
        onBackToProjects={onBackToProjects}
        onImportMedia={() => void pickAndImport()}
        onExport={handleExport}
        onOpenVersions={() => setVersionsOpen(true)}
        importing={importing}
      />

      {missingMedia.length > 0 && (
        <div className="notice notice--warning">
          <span>
            {interpolate(t.errors.missingMediaTitle, { count: missingMedia.length })} ·{' '}
            {t.errors.missingMediaHint}
          </span>
          {/*
            Một nút cho TỪNG file, không phải một nút chọn cả thư mục: hai media
            khác nhau có thể trùng tên, và đoán sai thì clip trỏ sang nhầm cảnh
            quay — kiểu hỏng chỉ lộ ra lúc xem lại bản dựng.
          */}
          {missingMedia.map((report) => (
            <ToolButton
              key={report.assetId}
              label={`${t.errors.relink}: ${report.name}`}
              variant="outline"
              disabled={relinking !== null}
              onClick={() => {
                void relink(report).then((ok) => {
                  // Bỏ khỏi banner ngay khi nối xong, thay vì chờ lượt quét sau.
                  if (ok)
                    setMissingMedia((list) =>
                      list.filter((item) => item.assetId !== report.assetId)
                    )
                })
              }}
            />
          ))}
        </div>
      )}

      <PanelGroup direction="vertical" className="workspace" autoSaveId="ai-video-studio.vertical">
        <Panel defaultSize={62} minSize={30}>
          <PanelGroup direction="horizontal" autoSaveId="ai-video-studio.horizontal">
            <Panel defaultSize={24} minSize={14} collapsible collapsedSize={0}>
              <AiStudioPanel
                importing={importing}
                onImportClick={() => void pickAndImport()}
                onAddToTimeline={handleAddToTimeline}
              />
            </Panel>

            <PanelResizeHandle className="resize-handle resize-handle--vertical" />

            <Panel defaultSize={52} minSize={26}>
              <PreviewPanel />
            </Panel>

            <PanelResizeHandle className="resize-handle resize-handle--vertical" />

            <Panel defaultSize={24} minSize={14} collapsible collapsedSize={0}>
              <InspectorPanel />
            </Panel>
          </PanelGroup>
        </Panel>

        <PanelResizeHandle className="resize-handle resize-handle--horizontal" />

        <Panel defaultSize={38} minSize={16}>
          <TimelinePanel />
        </Panel>
      </PanelGroup>

      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {versionsOpen && <ProjectVersionsDialog onClose={() => setVersionsOpen(false)} />}
      <KeyboardShortcutsDialog />
    </div>
  )
}
