import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { Clip, Track } from '../../../../shared/domain/timeline-track-types'
import type { FrameRate } from '../../../../shared/domain/time-units'
import { useT } from '../../i18n/use-translation'
import { ClipCutTransitionControls } from './clip-cut-transition-controls'
import { ClipMotionControls } from './clip-motion-controls'
import { SliderRow } from './inspector-slider-row'

/**
 * Tab Animation: những gì đổi theo THỜI GIAN — tốc độ, chuyển cảnh ở hai đầu clip,
 * zoom/chuyển động chạy suốt clip.
 *
 * Tốc độ chỉ có với clip có trục thời gian nguồn (video, tiếng): ảnh tĩnh không có
 * gì để phát nhanh hay chậm. Chuyển cảnh và zoom chỉ có với clip vẽ ra hình.
 */
export function ClipAnimationSection({
  clip,
  track,
  frameRate,
  run
}: {
  clip: Clip
  track: Track
  frameRate: FrameRate
  run(commands: EditorCommand[], label: string): void
}): JSX.Element {
  const t = useT()
  const visual = track.kind === 'video' || track.kind === 'image'
  const canSetSpeed = track.kind === 'video' || track.kind === 'audio'

  return (
    <>
      {canSetSpeed && (
        <>
          <p className="field-group__title">{t.inspector.speed}</p>
          <SliderRow
            label={t.inspector.speed}
            value={clip.speed}
            min={0.25}
            max={4}
            step={0.05}
            format={(value) => `${value.toFixed(2)}×`}
            onCommit={(value) =>
              run([{ type: 'clip/set-speed', clipId: clip.id, speed: value }], t.inspector.speed)
            }
          />
        </>
      )}

      {visual && (
        <ClipCutTransitionControls clip={clip} track={track} frameRate={frameRate} run={run} />
      )}

      {visual && (
        <ClipMotionControls
          clip={clip}
          onChange={(motion) =>
            run([{ type: 'clip/set-motion', clipId: clip.id, motion }], 'Đổi zoom')
          }
        />
      )}
    </>
  )
}
