import { useEffect, useState, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import { mediaFileUrl, type DetectedShotDto } from '../../../../shared/ipc/ipc-contract'
import { buildCutFromShots } from '../../state/build-cut-actions'
import { useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import '../export/export-dialog.css'
import './shot-cut-dialog.css'

/**
 * Dựng bản cut theo HÌNH: dò cú máy trong một video, bấm chọn các cảnh theo thứ
 * tự muốn xếp, rồi dựng.
 *
 * Dành cho footage không có lời nói (quay sản phẩm, b-roll) — ở đó không có bản
 * phiên âm để dựng theo lời. Trước đây việc này chỉ agent làm được.
 */
export function ShotCutDialog({
  asset,
  onClose
}: {
  asset: MediaAsset
  onClose(): void
}): JSX.Element {
  const t = useT()
  const projectId = useEditorStore((state) => state.session?.document.id)
  const [shots, setShots] = useState<DetectedShotDto[] | null>(null)
  const [order, setOrder] = useState<number[]>([])
  const [maxSeconds, setMaxSeconds] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void window.api.media
      .detectShots({ projectId, assetId: asset.id, sourcePath: asset.source.path })
      .then((result) => {
        if (cancelled) return
        if (result.ok) setShots(result.data)
        else {
          setShots([])
          setError(result.error)
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectId, asset.id, asset.source.path])

  const toggle = (index: number): void =>
    setOrder((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index]
    )

  const build = (): void => {
    if (!shots || !window.confirm(t.buildCut.replaceWarning)) return
    const seconds = Number(maxSeconds)
    const result = buildCutFromShots(
      asset.id,
      shots,
      order,
      maxSeconds.trim() && seconds > 0 ? Math.min(60, seconds) : undefined,
      t.buildCut.fromShotsLabel
    )
    if (result.ok) onClose()
    else setError(result.error)
  }

  const title = interpolate(t.buildCut.shotsTitle, { name: asset.name })
  return (
    <div className="export-dialog__backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="export-dialog shot-cut-dialog">
        <header className="export-dialog__header">
          <h2>{title}</h2>
          <ToolButton label={t.common.close} onClick={onClose} />
        </header>

        <div className="export-dialog__body">
          <p className="dialog-note">{t.buildCut.shotsHint}</p>
          {shots === null && <p className="dialog-note">{t.buildCut.detecting}</p>}
          {shots?.length === 0 && !error && <p className="dialog-note">{t.buildCut.noShots}</p>}
          {shots && shots.length > 0 && (
            <div className="shot-cut-dialog__grid">
              {shots.map((shot) => {
                const position = order.indexOf(shot.index)
                const seconds = ((shot.endUs - shot.startUs) / 1_000_000).toFixed(1)
                return (
                  <button
                    key={shot.index}
                    type="button"
                    className={`shot-cut-dialog__shot ${position >= 0 ? 'shot-cut-dialog__shot--picked' : ''}`}
                    aria-pressed={position >= 0}
                    aria-label={interpolate(t.buildCut.shotOrder, {
                      index: shot.index + 1,
                      seconds
                    })}
                    onClick={() => toggle(shot.index)}
                  >
                    {shot.framePath ? (
                      <img src={mediaFileUrl(shot.framePath)} alt="" draggable={false} />
                    ) : (
                      <span className="shot-cut-dialog__blank" />
                    )}
                    <span className="shot-cut-dialog__meta">
                      #{shot.index + 1} · {seconds}s
                    </span>
                    {position >= 0 && (
                      <span className="shot-cut-dialog__order">{position + 1}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          <label className="field-row">
            <span className="field-row__label">{t.buildCut.maxShotSeconds}</span>
            <input
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              value={maxSeconds}
              onChange={(event) => setMaxSeconds(event.target.value)}
            />
          </label>
          {error && <div className="notice">{error}</div>}
        </div>

        <footer className="export-dialog__footer">
          <p className="dialog-note">
            {interpolate(t.buildCut.selectedCount, { count: order.length })}
          </p>
          <ToolButton
            label={t.buildCut.build}
            variant="primary"
            disabled={order.length === 0}
            onClick={build}
          />
        </footer>
      </div>
    </div>
  )
}
