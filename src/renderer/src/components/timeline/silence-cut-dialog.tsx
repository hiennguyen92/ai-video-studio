import { useMemo, useState, type JSX } from 'react'
import type { SilenceInterval } from '../../../../shared/ipc/silence-detection-types'
import { expandToLinkGroups } from '../../../../shared/domain/clip-link-groups'
import {
  planSilenceCuts,
  type SilenceCutScope
} from '../../../../shared/domain/silence-cut-planner'
import { clipSourceSpanUs } from '../../../../shared/domain/timeline-track-types'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import '../export/export-dialog.css'

/**
 * Cắt khoảng lặng trong các clip đang chọn.
 *
 * Hai bước có chủ ý: DÒ trước, báo "tìm thấy bao nhiêu, cắt bớt bao nhiêu giây",
 * rồi mới CẮT. Ngưỡng -35 dB hợp giọng thu gần nhưng hụt với phòng ồn; cắt ngay
 * không cho xem trước thì người dùng chỉ biết ngưỡng sai sau khi nửa câu đã mất.
 *
 * Kết quả dò giữ lại khi chỉ đổi phần chừa hay phạm vi — hai thứ đó không cần dò
 * lại; đổi ngưỡng hay độ dài tối thiểu thì phải dò lại.
 */
export function SilenceCutDialog({ onClose }: { onClose(): void }): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const selection = useEditorStore((state) => state.selection.clipIds)
  const run = useEditorStore((state) => state.run)

  const [noiseDb, setNoiseDb] = useState(-35)
  // Mặc định tự đo: -35 dB cố định không bắt được gì trong phòng có quạt.
  const [autoThreshold, setAutoThreshold] = useState(true)
  const [usedThresholdDb, setUsedThresholdDb] = useState<number | null>(null)
  const [minSilence, setMinSilence] = useState(0.5)
  const [padding, setPadding] = useState(0.15)
  const [scope, setScope] = useState<SilenceCutScope>('clip-tracks')
  const [silences, setSilences] = useState<Record<string, SilenceInterval[]> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clip có tiếng trong vùng chọn (kể cả nhóm) — chỉ chúng mới dò được.
  const audibleClips = useMemo(() => {
    if (!document) return []
    const ids = expandToLinkGroups(document, selection)
    return document.tracks.flatMap((track) =>
      track.kind === 'audio' || track.kind === 'video'
        ? track.clips
            .filter((clip) => ids.includes(clip.id))
            .map((clip) => ({
              clip,
              asset: document.assets.find((item) => item.id === clip.assetId)
            }))
            .filter((item) => item.asset?.probe.hasAudio)
        : []
    )
  }, [document, selection])

  const plan = useMemo(
    () =>
      document && silences
        ? planSilenceCuts(document, silences, {
            paddingUs: Math.round(padding * 1_000_000),
            scope,
            frameRate: document.settings.frameRate
          })
        : null,
    [document, silences, padding, scope]
  )

  const detect = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const found: Record<string, SilenceInterval[]> = {}
    const used: number[] = []
    for (const { clip, asset } of audibleClips) {
      const result = await window.api.media.detectSilences({
        sourcePath: asset!.source.path,
        startUs: clip.sourceInUs,
        endUs: clip.sourceInUs + clipSourceSpanUs(clip),
        noiseDb: autoThreshold ? undefined : noiseDb,
        minSilenceUs: Math.round(minSilence * 1_000_000)
      })
      if (!result.ok) {
        setError(result.error)
        setBusy(false)
        return
      }
      found[clip.id] = result.data.intervals
      used.push(result.data.thresholdDb)
    }
    setSilences(found)
    // Đưa mức tự đo vào ô ngưỡng: muốn chỉnh tay thì bắt đầu từ con số đúng với
    // phòng này, không phải từ -35.
    if (autoThreshold && used.length > 0) setNoiseDb(Math.round(Math.max(...used)))
    setUsedThresholdDb(used.length > 0 ? Math.max(...used) : null)
    setBusy(false)
  }

  const cut = (): void => {
    if (!plan || plan.commands.length === 0) return
    if (run(plan.commands, t.silenceCut.title)) onClose()
  }

  // Đổi ngưỡng thì kết quả dò cũ không còn đúng.
  const invalidate = (): void => setSilences(null)

  return (
    <div
      className="export-dialog__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.silenceCut.title}
    >
      <div className="export-dialog">
        <header className="export-dialog__header">
          <h2>{t.silenceCut.title}</h2>
          <ToolButton label={t.common.close} onClick={onClose} disabled={busy} />
        </header>

        <div className="export-dialog__body">
          <p className="dialog-note">{t.silenceCut.hint}</p>
          {audibleClips.length === 0 && (
            <p className="dialog-note dialog-note--strong">{t.silenceCut.noAudio}</p>
          )}

          <div className="field-row">
            <span className="field-row__label">{t.silenceCut.threshold}</span>
            {/*
              Ô số và ô "tự đo" chung một hàng: tự đo là CÁCH điền ô ngưỡng, không
              phải một cài đặt riêng. Đứng tách hàng thì ô tích trôi giữa cột và
              không ai đoán được nó điều khiển ô nào.
            */}
            <div className="export-dialog__inline">
              <input
                type="number"
                min={-80}
                max={-10}
                step={1}
                value={noiseDb}
                disabled={autoThreshold}
                aria-label={t.silenceCut.threshold}
                onChange={(event) => {
                  setNoiseDb(Number(event.target.value) || -35)
                  invalidate()
                }}
              />
              <label className="export-dialog__checkbox">
                <input
                  type="checkbox"
                  checked={autoThreshold}
                  aria-label={t.silenceCut.autoThreshold}
                  onChange={(event) => {
                    setAutoThreshold(event.target.checked)
                    invalidate()
                  }}
                />
                <span>{t.silenceCut.autoThresholdShort}</span>
              </label>
            </div>
          </div>
          <div className="field-row">
            <span className="field-row__label">{t.silenceCut.minSilence}</span>
            <input
              type="number"
              min={0.2}
              max={10}
              step={0.1}
              value={minSilence}
              aria-label={t.silenceCut.minSilence}
              onChange={(event) => {
                setMinSilence(Math.max(0.2, Number(event.target.value) || 0.5))
                invalidate()
              }}
            />
          </div>
          <div className="field-row">
            <span className="field-row__label">{t.silenceCut.padding}</span>
            <input
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={padding}
              aria-label={t.silenceCut.padding}
              onChange={(event) => setPadding(Math.max(0, Number(event.target.value) || 0))}
            />
          </div>
          <div className="field-row">
            <span className="field-row__label">{t.silenceCut.scope}</span>
            <select
              value={scope}
              aria-label={t.silenceCut.scope}
              onChange={(event) => setScope(event.target.value as SilenceCutScope)}
            >
              <option value="clip-tracks">{t.silenceCut.scopeClipTracks}</option>
              <option value="all-tracks">{t.silenceCut.scopeAllTracks}</option>
            </select>
          </div>

          {error && <p className="dialog-note dialog-note--strong">{error}</p>}
          {plan && (
            <p className="dialog-note dialog-note--strong" role="status">
              {plan.cutCount === 0
                ? t.silenceCut.nothingFound
                : interpolate(t.silenceCut.found, {
                    count: plan.cutCount,
                    seconds: (plan.removedUs / 1_000_000).toFixed(1)
                  })}
              {usedThresholdDb !== null &&
                ` · ${interpolate(t.silenceCut.thresholdUsed, { db: usedThresholdDb.toFixed(1) })}`}
            </p>
          )}
        </div>

        <footer className="export-dialog__footer">
          <ToolButton
            label={busy ? t.silenceCut.detecting : t.silenceCut.detect}
            variant={plan ? 'outline' : 'primary'}
            disabled={busy || audibleClips.length === 0}
            onClick={() => void detect()}
          />
          <ToolButton
            label={t.silenceCut.apply}
            variant="primary"
            disabled={busy || !plan || plan.cutCount === 0}
            onClick={cut}
          />
        </footer>
      </div>
    </div>
  )
}
