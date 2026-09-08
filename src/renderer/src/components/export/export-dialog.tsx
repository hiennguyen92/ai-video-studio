import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type { ExportCapabilities, ExportProgressEvent } from '../../../../shared/ipc/ipc-contract'
import { FRAME_RATE_PRESETS, formatClockTime } from '../../../../shared/domain/time-units'
import { selectDocument, selectDurationUs, useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { EmptyState } from '../ui/empty-state'
import './export-dialog.css'

/**
 * Hộp thoại xuất video (DESCRIPTION §8).
 *
 * Thanh tiến trình chỉ chạy khi ffmpeg thực sự báo mốc thời gian. Trước đó nó ở
 * trạng thái "đang chuẩn bị" dạng sọc chạy — cố tình KHÔNG bịa phần trăm.
 */

const RESOLUTION_SCALES = [
  { key: 'full', label: '100%', factor: 1 },
  { key: 'half', label: '50%', factor: 0.5 },
  { key: 'quarter', label: '25%', factor: 0.25 }
]

const FRAME_RATE_OPTIONS = ['24', '25', '30', '50', '60'] as const

/** Tìm khoá fps trùng với fps của dự án; không có thì rơi về 30. */
function matchFrameRateKey(projectFps?: { num: number; den: number }): string {
  if (!projectFps) return '30'
  return (
    FRAME_RATE_OPTIONS.find((key) => {
      const preset = FRAME_RATE_PRESETS[key]
      return preset.num === projectFps.num && preset.den === projectFps.den
    }) ?? '30'
  )
}

/** Độ phân giải phải chẵn: encoder H.264 với yuv420p không nhận cạnh lẻ. */
function toEvenSize(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

export function ExportDialog({ onClose }: { onClose(): void }): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const durationUs = useEditorStore(selectDurationUs)

  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [scaleKey, setScaleKey] = useState('full')
  // Khớp fps mặc định với fps dự án ngay từ lần render đầu. Làm việc này trong
  // một effect sẽ gây thêm một vòng render và nháy giá trị trên màn hình.
  const [frameRateKey, setFrameRateKey] = useState<string>(() =>
    matchFrameRateKey(document?.settings.frameRate)
  )
  const [useHardware, setUseHardware] = useState(false)
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null)
  const [burnSubtitleTrackId, setBurnSubtitleTrackId] = useState<string>('')
  const [exportSrt, setExportSrt] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgressEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.export.capabilities().then((result) => {
      if (!result.ok) return
      setCapabilities(result.data)
      setUseHardware(result.data.hardwareEncoderAvailable)
    })
  }, [])

  useEffect(() => {
    return window.api.export.onProgress((event) => {
      setProgress(event)
      if (event.status === 'failed') setError(event.error ?? t.export.failed)
      if (event.status !== 'running') setJobId(null)
    })
  }, [t.export.failed])

  const targetSize = useMemo(() => {
    if (!document) return { width: 0, height: 0 }
    const factor = RESOLUTION_SCALES.find((item) => item.key === scaleKey)?.factor ?? 1
    return {
      width: toEvenSize(document.settings.width * factor),
      height: toEvenSize(document.settings.height * factor)
    }
  }, [document, scaleKey])

  const handlePickPath = useCallback(async () => {
    if (!document) return
    const safeName = document.name.replace(/[/\\:*?"<>|]/g, '-')
    const result = await window.api.export.pickOutputPath(`${safeName}.mp4`)
    if (result.ok && result.data) setOutputPath(result.data)
    else if (!result.ok) setError(result.error)
  }, [document])

  const handleStart = useCallback(async () => {
    if (!document || !outputPath) return
    setError(null)
    setProgress(null)

    const result = await window.api.export.start({
      // Bản chụp document tại đúng thời điểm này — chỉnh sửa sau đó không ảnh
      // hưởng tới bản đang render.
      document,
      outputPath,
      width: targetSize.width,
      height: targetSize.height,
      frameRate: FRAME_RATE_PRESETS[frameRateKey],
      useHardwareEncoder: useHardware,
      burnSubtitleTrackId: burnSubtitleTrackId || undefined,
      exportSrtTrackId: exportSrt
        ? burnSubtitleTrackId || document.subtitleTracks[0]?.id
        : undefined
    })

    if (result.ok) setJobId(result.data.jobId)
    else setError(result.error)
  }, [document, outputPath, targetSize, frameRateKey, useHardware, burnSubtitleTrackId, exportSrt])

  const handleCancel = useCallback(async () => {
    if (jobId) await window.api.export.cancel(jobId)
  }, [jobId])

  if (!document) return <></>

  const running = jobId !== null
  const subtitleTracks = document.subtitleTracks
  const isEmpty = durationUs <= 0

  return (
    <div
      className="export-dialog__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.export.title}
    >
      <div className="export-dialog">
        <header className="export-dialog__header">
          <h2>{t.export.title}</h2>
          <ToolButton label={t.common.close} onClick={onClose} disabled={running} />
        </header>

        {isEmpty ? (
          <EmptyState title={t.export.emptyTimeline} hint={t.export.emptyTimelineHint} />
        ) : (
          <div className="export-dialog__body">
            <div className="field-row">
              <span className="field-row__label">{t.export.outputLabel}</span>
              <div className="export-dialog__path">
                <span className="export-dialog__path-value" title={outputPath ?? undefined}>
                  {outputPath ?? t.export.notChosen}
                </span>
                <ToolButton
                  label={t.export.choosePath}
                  variant="outline"
                  onClick={() => void handlePickPath()}
                  disabled={running}
                />
              </div>
            </div>

            <div className="field-row">
              <span className="field-row__label">{t.export.resolution}</span>
              <div className="export-dialog__inline">
                <select
                  value={scaleKey}
                  onChange={(event) => setScaleKey(event.target.value)}
                  disabled={running}
                  aria-label={t.export.resolution}
                >
                  {RESOLUTION_SCALES.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="field-row__value">
                  {targetSize.width}×{targetSize.height}
                </span>
              </div>
            </div>

            <div className="field-row">
              <span className="field-row__label">{t.export.frameRate}</span>
              <select
                value={frameRateKey}
                onChange={(event) => setFrameRateKey(event.target.value)}
                disabled={running}
                aria-label={t.export.frameRate}
              >
                {FRAME_RATE_OPTIONS.map((key) => (
                  <option key={key} value={key}>
                    {key} fps
                  </option>
                ))}
              </select>
            </div>

            <div className="field-row">
              <span className="field-row__label">{t.export.hardware}</span>
              <label className="export-dialog__checkbox">
                <input
                  type="checkbox"
                  checked={useHardware}
                  onChange={(event) => setUseHardware(event.target.checked)}
                  disabled={running || !capabilities?.hardwareEncoderAvailable}
                />
                <span>
                  {capabilities?.hardwareEncoderAvailable
                    ? (capabilities.hardwareEncoderName ?? '')
                    : t.export.hardwareUnavailable}
                </span>
              </label>
            </div>

            <div className="field-row">
              <span className="field-row__label">{t.export.burnSubtitles}</span>
              {subtitleTracks.length === 0 ? (
                <span className="field-row__value">{t.export.noSubtitles}</span>
              ) : (
                <select
                  value={burnSubtitleTrackId}
                  onChange={(event) => setBurnSubtitleTrackId(event.target.value)}
                  disabled={running}
                  aria-label={t.export.burnSubtitles}
                >
                  <option value="">—</option>
                  {subtitleTracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {subtitleTracks.length > 0 && (
              <div className="field-row">
                <span className="field-row__label">{t.export.exportSrt}</span>
                <label className="export-dialog__checkbox">
                  <input
                    type="checkbox"
                    checked={exportSrt}
                    onChange={(event) => setExportSrt(event.target.checked)}
                    disabled={running}
                  />
                  <span>.srt</span>
                </label>
              </div>
            )}

            <div className="field-row">
              <span className="field-row__label">{t.inspector.duration}</span>
              <span className="field-row__value">{formatClockTime(durationUs)}</span>
            </div>

            {(running || progress) && <ExportProgressView progress={progress} running={running} />}

            {error && (
              <div className="notice">{interpolate(t.errors.generic, { message: error })}</div>
            )}
          </div>
        )}

        <footer className="export-dialog__footer">
          {running ? (
            <ToolButton
              label={t.export.cancel}
              variant="danger"
              onClick={() => void handleCancel()}
            />
          ) : (
            <ToolButton
              label={t.export.start}
              variant="primary"
              onClick={() => void handleStart()}
              disabled={!outputPath || isEmpty}
            />
          )}
        </footer>
      </div>
    </div>
  )
}

function ExportProgressView({
  progress,
  running
}: {
  progress: ExportProgressEvent | null
  running: boolean
}): JSX.Element {
  const t = useT()

  // Chưa có mốc thời gian nào từ ffmpeg -> hiện sọc chạy vô định, không hiện %.
  const indeterminate = running && progress?.ratio === undefined
  const percent = progress?.ratio !== undefined ? Math.round(progress.ratio * 100) : null

  const statusText =
    progress?.status === 'succeeded'
      ? t.export.succeeded
      : progress?.status === 'cancelled'
        ? t.export.cancelled
        : progress?.status === 'failed'
          ? t.export.failed
          : indeterminate
            ? t.export.preparing
            : t.export.running

  return (
    <div className="export-progress">
      <div className="export-progress__bar">
        <div
          className={`export-progress__fill ${indeterminate ? 'export-progress__fill--indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: `${percent ?? 0}%` }}
        />
      </div>
      <div className="export-progress__labels">
        <span>{statusText}</span>
        {percent !== null && running && <span>{percent}%</span>}
        {progress?.speed !== undefined && running && (
          <span>{interpolate(t.export.speed, { speed: progress.speed.toFixed(1) })}</span>
        )}
      </div>

      {progress?.status === 'succeeded' && progress.outputPath && (
        <p className="export-progress__result selectable">
          {interpolate(t.export.savedTo, { path: progress.outputPath })}
        </p>
      )}
      {progress?.status === 'succeeded' && progress.srtPath && (
        <p className="export-progress__result selectable">
          {interpolate(t.export.srtSavedTo, { path: progress.srtPath })}
        </p>
      )}
    </div>
  )
}
