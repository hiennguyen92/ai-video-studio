import { useCallback, useState, type JSX } from 'react'
import {
  guessDuckingTracks,
  hasMusicAndSpeech,
  planAutoDucking
} from '../../../../shared/domain/auto-ducking-planner'
import { selectDocument, useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Giảm nhạc khi có lời nói, bấm tay.
 *
 * AI Chat cũng gọi được việc này, nhưng không thể để nó CHỈ dùng được qua chat:
 * chat cần một máy chủ LLM, còn đây là thao tác thuần cục bộ. Bắt người dùng
 * dựng cả một máy chủ mô hình ngôn ngữ chỉ để hạ âm lượng vài đoạn nhạc là vô lý.
 *
 * Cả hai đường đi vào cùng một hàm dựng kế hoạch, nên kết quả không thể lệch nhau.
 */

export function AutoDuckingSection(): JSX.Element {
  const t = useT()
  const document = useEditorStore(selectDocument)
  const run = useEditorStore((state) => state.run)

  const [duckPercent, setDuckPercent] = useState(25)
  const [basePercent, setBasePercent] = useState(100)
  const [paddingSeconds, setPaddingSeconds] = useState(0.25)
  const [rampSeconds, setRampSeconds] = useState(0.3)
  const [notice, setNotice] = useState<string | null>(null)

  const ready = document ? hasMusicAndSpeech(document) : false

  const apply = useCallback(() => {
    if (!document) return
    const { musicTrackIds, speechTrackIds } = guessDuckingTracks(document)

    const plan = planAutoDucking(document, {
      musicTrackIds,
      speechTrackIds,
      duckVolume: duckPercent / 100,
      baseVolume: basePercent / 100,
      paddingUs: Math.round(paddingSeconds * 1_000_000),
      rampUs: Math.round(rampSeconds * 1_000_000)
    })

    if (plan.duckedClips === 0) {
      setNotice(t.ducking.nothing)
      return
    }

    // Một giao dịch: hoàn tác một lần là trả nhạc về nguyên trạng.
    const applied = run(plan.commands, 'Giảm nhạc khi có lời nói')
    setNotice(applied ? interpolate(t.ducking.applied, { count: plan.duckedClips }) : null)
  }, [document, duckPercent, basePercent, paddingSeconds, rampSeconds, run, t.ducking])

  return (
    <div className="music-generation">
      <p className="field-group__title">{t.ducking.section}</p>
      <p className="music-panel__hint">{t.ducking.hint}</p>

      <div className="field-row">
        <span className="field-row__label">{t.ducking.duckVolume}</span>
        <input
          type="number"
          min={0}
          max={100}
          value={duckPercent}
          aria-label={t.ducking.duckVolume}
          onChange={(event) => setDuckPercent(Number(event.target.value) || 0)}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.ducking.baseVolume}</span>
        <input
          type="number"
          min={0}
          max={200}
          value={basePercent}
          aria-label={t.ducking.baseVolume}
          onChange={(event) => setBasePercent(Number(event.target.value) || 0)}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.ducking.padding}</span>
        <input
          type="number"
          min={0}
          max={5}
          step={0.05}
          value={paddingSeconds}
          aria-label={t.ducking.padding}
          onChange={(event) => setPaddingSeconds(Number(event.target.value) || 0)}
        />
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.ducking.ramp}</span>
        <input
          type="number"
          min={0.1}
          max={5}
          step={0.05}
          value={rampSeconds}
          aria-label={t.ducking.ramp}
          onChange={(event) => setRampSeconds(Number(event.target.value) || 0)}
        />
      </div>

      <div className="music-panel__actions">
        <ToolButton label={t.ducking.apply} variant="outline" disabled={!ready} onClick={apply} />
      </div>

      {!ready && <p className="music-panel__hint">{t.ducking.needsBoth}</p>}
      {notice && <p className="music-panel__hint">{notice}</p>}
    </div>
  )
}
