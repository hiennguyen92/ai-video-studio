import type { JSX } from 'react'
import type {
  DubbingOverflowStrategy,
  DubbingSegment
} from '../../../../shared/domain/transcript-types'
import type { SegmentOverflowPlan } from '../../../../shared/domain/dubbing-overflow-planner'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { interpolate, useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'

/**
 * Một dòng trong danh sách đoạn lồng tiếng.
 *
 * Điểm quan trọng của giao diện này: khi audio dài hơn khoảng gốc, nó bày ra
 * ĐÚNG những lối thoát còn dùng được — và "cắt bớt lời" không bao giờ nằm trong
 * số đó. Tăng tốc bị ẩn đi khi hệ số cần thiết vượt ngưỡng nghe được, kèm lời
 * giải thích, thay vì để nút đó bấm được rồi mới báo lỗi.
 */

function formatDuration(us: number): string {
  return formatClockTime(us, true)
}

export function DubbingSegmentRow({
  index,
  segment,
  text,
  plan,
  maxSpeedUp,
  busy,
  onGenerate,
  onChooseStrategy,
  onEditText
}: {
  index: number
  segment: DubbingSegment
  text: string
  plan: SegmentOverflowPlan
  maxSpeedUp: number
  busy: boolean
  onGenerate(): void
  onChooseStrategy(strategy: DubbingOverflowStrategy | undefined): void
  onEditText(next: string): void
}): JSX.Element {
  const t = useT()
  const overflowing = plan.measured && plan.overflowUs > 0

  return (
    <article className={`dubbing-row ${overflowing ? 'dubbing-row--overflow' : ''}`}>
      <div className="dubbing-row__head">
        <span className="dubbing-row__time">{formatClockTime(segment.targetStartUs)}</span>
        <span className="dubbing-row__status">
          {segment.status === 'generating'
            ? t.dubbing.generating
            : segment.status === 'failed'
              ? t.dubbing.failed
              : segment.status === 'ready'
                ? t.dubbing.ready
                : t.dubbing.pending}
        </span>
      </div>

      <textarea
        className="dubbing-row__text"
        value={text}
        rows={2}
        aria-label={interpolate(t.dubbing.segmentText, { index: index + 1 })}
        disabled={busy}
        onChange={(event) => onEditText(event.target.value)}
      />

      <div className="dubbing-row__meta">
        <span>
          {interpolate(t.dubbing.target, { duration: formatDuration(plan.targetSpanUs) })}
        </span>
        {plan.measured && (
          <span>
            {interpolate(t.dubbing.measured, {
              duration: formatDuration(plan.measuredDurationUs ?? 0)
            })}
          </span>
        )}
        {plan.measured &&
          (overflowing ? (
            <span className="dubbing-row__warn">
              {interpolate(t.dubbing.overflowBy, { duration: formatDuration(plan.overflowUs) })}
            </span>
          ) : (
            <span>{t.dubbing.fits}</span>
          ))}
      </div>

      {overflowing && (
        <div className="dubbing-row__strategies">
          <span className="field-row__label">{t.dubbing.strategy}</span>

          {plan.canSpeedUp ? (
            <ToolButton
              label={interpolate(t.dubbing.strategySpeedUp, {
                speed: plan.requiredSpeed.toFixed(2)
              })}
              variant={segment.overflowStrategy === 'speed-up' ? 'primary' : 'outline'}
              active={segment.overflowStrategy === 'speed-up'}
              onClick={() => onChooseStrategy('speed-up')}
            />
          ) : (
            // Nói rõ vì sao không có nút tăng tốc, thay vì lặng lẽ giấu đi.
            <span className="dubbing-row__warn">
              {interpolate(t.dubbing.speedUpTooMuch, {
                speed: plan.requiredSpeed.toFixed(2),
                max: String(maxSpeedUp)
              })}
            </span>
          )}

          <ToolButton
            label={t.dubbing.strategyShorten}
            variant={segment.overflowStrategy === 'shorten-text' ? 'primary' : 'outline'}
            active={segment.overflowStrategy === 'shorten-text'}
            onClick={() => onChooseStrategy('shorten-text')}
          />
          <ToolButton
            label={t.dubbing.strategyExtend}
            variant={segment.overflowStrategy === 'extend-timeline' ? 'primary' : 'outline'}
            active={segment.overflowStrategy === 'extend-timeline'}
            onClick={() => onChooseStrategy('extend-timeline')}
          />
        </div>
      )}

      <div className="dubbing-row__actions">
        <ToolButton label={t.dubbing.generateOne} disabled={busy} onClick={onGenerate} />
        {segment.error && <span className="dubbing-row__warn">{segment.error}</span>}
      </div>
    </article>
  )
}
