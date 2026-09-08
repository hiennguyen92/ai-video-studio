import { useCallback, useMemo, useState, type DragEvent, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { countAssetUsages } from '../../../../shared/domain/project-document-types'
import { useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import {
  IconFilm,
  IconImage,
  IconImport,
  IconSearch,
  IconSparkle,
  IconTrash,
  IconWaveform
} from '../ui/icons'
import './media-library-panel.css'

/**
 * Tab Media của AI Studio.
 *
 * Media do AI tạo nằm CHUNG danh sách với media import, chỉ khác một huy hiệu nhỏ
 * (DESCRIPTION §3.A "Nội dung AI tạo ra cũng xuất hiện ở thư viện này").
 */

/** Kiểu dữ liệu kéo-thả, timeline đọc lại đúng khoá này. */
export const MEDIA_DRAG_MIME = 'application/x-ai-video-studio-asset'

type FilterKind = 'all' | 'video' | 'audio' | 'image' | 'generated'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function assetIcon(asset: MediaAsset): JSX.Element {
  if (asset.kind === 'video') return <IconFilm />
  if (asset.kind === 'audio') return <IconWaveform />
  return <IconImage />
}

export function MediaLibraryPanel({
  importing,
  onImportClick,
  onAddToTimeline
}: {
  importing: boolean
  onImportClick(): void
  onAddToTimeline(asset: MediaAsset): void
}): JSX.Element {
  const t = useT()
  const assets = useEditorStore((state) => state.session?.document.assets)
  const document = useEditorStore((state) => state.session?.document)
  const run = useEditorStore((state) => state.run)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')

  const [cleaning, setCleaning] = useState(false)

  const handleCleanup = useCallback(async () => {
    if (!document || cleaning) return
    setCleaning(true)
    try {
      const scan = await window.api.project.scanGarbage(document)
      if (!scan.ok) return

      if (scan.data.fileCount === 0) {
        window.alert(t.media.cleanupNothing)
        return
      }

      // Hỏi bằng CON SỐ THẬT đã quét được, không phải bằng một lời chung chung:
      // người dùng cần biết mình sắp giải phóng bao nhiêu trước khi đồng ý.
      const confirmed = window.confirm(
        interpolate(t.media.cleanupConfirm, {
          count: scan.data.fileCount,
          size: formatBytes(scan.data.totalBytes)
        })
      )
      if (!confirmed) return

      const removed = await window.api.project.removeGarbage(document)
      if (removed.ok) {
        window.alert(
          interpolate(t.media.cleanupDone, {
            count: removed.data.fileCount,
            size: formatBytes(removed.data.totalBytes)
          })
        )
      }
    } finally {
      setCleaning(false)
    }
  }, [document, cleaning, t.media])

  const handleRemove = useCallback(
    (asset: MediaAsset) => {
      if (!document) return
      const usages = countAssetUsages(document, asset.id)

      // Không dùng ở đâu thì xoá thẳng — vẫn hoàn tác được bằng Ctrl+Z. Chỉ hỏi
      // khi việc xoá kéo theo mất clip trên timeline, và nói RA số clip sẽ mất.
      if (usages > 0) {
        const confirmed = window.confirm(
          interpolate(t.media.removeConfirm, { name: asset.name, count: usages })
        )
        if (!confirmed) return
      }

      run(
        [{ type: 'asset/remove', assetId: asset.id, removeUsages: usages > 0 }],
        `Xoá media "${asset.name}"`
      )
    },
    [document, run, t.media.removeConfirm]
  )

  const filtered = useMemo(() => {
    const list = assets ?? []
    const needle = query.trim().toLowerCase()
    return list.filter((asset) => {
      if (needle && !asset.name.toLowerCase().includes(needle)) return false
      if (filter === 'all') return true
      if (filter === 'generated') return asset.origin === 'generated'
      return asset.kind === filter
    })
  }, [assets, query, filter])

  const handleDragStart = (event: DragEvent<HTMLElement>, asset: MediaAsset): void => {
    event.dataTransfer.setData(MEDIA_DRAG_MIME, asset.id)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const filters: Array<{ key: FilterKind; label: string }> = [
    { key: 'all', label: t.media.filterAll },
    { key: 'video', label: t.media.filterVideo },
    { key: 'audio', label: t.media.filterAudio },
    { key: 'image', label: t.media.filterImage },
    { key: 'generated', label: t.media.filterGenerated }
  ]

  const hasAssets = (assets?.length ?? 0) > 0

  return (
    <div className="media-library">
      <div className="media-library__toolbar">
        <ToolButton
          label={t.media.importButton}
          icon={<IconImport />}
          variant="outline"
          onClick={onImportClick}
          disabled={importing}
        />
        <ToolButton
          label={cleaning ? t.media.cleaningUp : t.media.cleanup}
          icon={<IconTrash />}
          variant="outline"
          onClick={() => void handleCleanup()}
          disabled={cleaning || !document}
        />
        <div className="media-library__search">
          <IconSearch />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.media.search}
            aria-label={t.media.search}
          />
        </div>
      </div>

      <div className="media-library__filters">
        {filters.map((option) => (
          <button
            key={option.key}
            type="button"
            className={`media-library__filter ${filter === option.key ? 'media-library__filter--active' : ''}`}
            onClick={() => setFilter(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="media-library__grid">
        {!hasAssets && (
          <EmptyState
            title={t.media.empty}
            hint={t.media.emptyHint}
            action={
              <ToolButton
                label={t.media.importButton}
                icon={<IconImport />}
                variant="primary"
                onClick={onImportClick}
                disabled={importing}
              />
            }
          />
        )}

        {hasAssets && filtered.length === 0 && (
          <EmptyState title={t.media.noResults} hint={t.media.emptyHint} />
        )}

        {filtered.map((asset) => (
          <article
            key={asset.id}
            className={`media-card ${asset.missing ? 'media-card--missing' : ''}`}
            draggable
            onDragStart={(event) => handleDragStart(event, asset)}
            onDoubleClick={() => onAddToTimeline(asset)}
            title={interpolate('{name} · {hint}', { name: asset.name, hint: t.media.dragHint })}
          >
            <div className="media-card__thumb">
              {asset.derived.thumbnailPath ? (
                <img src={mediaFileUrl(asset.derived.thumbnailPath)} alt="" draggable={false} />
              ) : (
                <span className="media-card__thumb-fallback">{assetIcon(asset)}</span>
              )}
              {asset.probe.durationUs > 0 && (
                <span className="media-card__duration">
                  {formatClockTime(asset.probe.durationUs, false)}
                </span>
              )}
              {asset.origin === 'generated' && (
                <span className="media-card__badge" title={t.media.generatedBadge}>
                  <IconSparkle width={11} height={11} />
                  {t.media.generatedBadge}
                </span>
              )}
            </div>

            <div className="media-card__info">
              <span className="media-card__name" title={asset.name}>
                {asset.name}
              </span>
              <span className="media-card__meta">
                {asset.missing ? (
                  <span className="media-card__missing">{t.media.missing}</span>
                ) : (
                  <>
                    {assetIcon(asset)}
                    {asset.probe.width ? `${asset.probe.width}×${asset.probe.height}` : asset.kind}
                  </>
                )}
              </span>
            </div>

            <ToolButton
              label={t.media.addToTimeline}
              icon={<IconFilm />}
              iconOnly
              className="media-card__add"
              onClick={() => onAddToTimeline(asset)}
              disabled={asset.missing}
            />

            <ToolButton
              label={interpolate(t.media.remove, { name: asset.name })}
              icon={<IconTrash />}
              iconOnly
              variant="danger"
              className="media-card__remove"
              onClick={() => handleRemove(asset)}
            />
          </article>
        ))}
      </div>
    </div>
  )
}
