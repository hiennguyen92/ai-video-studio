import type { JSX } from 'react'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import {
  DEFAULT_CLIP_TRANSFORM,
  type Clip,
  type ClipTransform
} from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { ToolButton } from '../ui/tool-button'
import { ClipColorControls } from './clip-color-controls'
import { ClipEffectStackControls } from './clip-effect-stack-controls'
import { ClipLookControls } from './clip-look-controls'
import { ClipBackgroundFillControl } from './clip-background-fill-control'
import { SliderRow } from './inspector-slider-row'
import { useKeyframeField } from './use-keyframe-field'

/**
 * Tab Video: những gì đổi HÌNH của clip, theo đúng thứ tự người dùng nghĩ về nó —
 * effect, look màu, chỉnh màu, rồi biến đổi khung (mờ, phóng, vị trí).
 */
export function ClipVideoSection({
  clip,
  run,
  onTransform
}: {
  clip: Clip
  run(commands: EditorCommand[], label: string): void
  onTransform(transform: ClipTransform, label: string): void
}): JSX.Element {
  const t = useT()
  const transform = clip.transform ?? DEFAULT_CLIP_TRANSFORM
  // Một hook cho mỗi thuộc tính. Gọi ở thân component chứ không trong vòng lặp:
  // số lượng và thứ tự cố định, đúng quy tắc hook của React.
  const target = { kind: 'clip' as const, clipId: clip.id }
  const opacityKeyframe = useKeyframeField(target, ['transform.opacity'], t.inspector.opacity)
  const scaleKeyframe = useKeyframeField(target, ['transform.scale'], t.inspector.scale)
  const xKeyframe = useKeyframeField(target, ['transform.x'], t.inspector.positionX)
  const yKeyframe = useKeyframeField(target, ['transform.y'], t.inspector.positionY)

  return (
    <>
      <ClipEffectStackControls clip={clip} run={run} />

      <ClipLookControls
        clip={clip}
        onChange={(look) => run([{ type: 'clip/set-look', clipId: clip.id, look }], 'Đổi filter')}
      />

      <ClipColorControls
        clip={clip}
        onChange={(grade) =>
          run([{ type: 'clip/set-color-grade', clipId: clip.id, grade }], 'Chỉnh Adjust')
        }
      />

      <ClipBackgroundFillControl clip={clip} run={run} />

      <p className="field-group__title">{t.inspector.transform}</p>
      <SliderRow
        label={t.inspector.opacity}
        value={transform.opacity}
        min={0}
        max={1}
        step={0.01}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(value) => onTransform({ ...transform, opacity: value }, t.inspector.opacity)}
        keyframe={opacityKeyframe}
      />
      <SliderRow
        label={t.inspector.scale}
        value={transform.scale}
        min={0.1}
        max={4}
        step={0.01}
        format={(value) => `${value.toFixed(2)}×`}
        onCommit={(value) => onTransform({ ...transform, scale: value }, t.inspector.scale)}
        keyframe={scaleKeyframe}
      />
      <SliderRow
        label={t.inspector.positionX}
        value={transform.x}
        min={-1}
        max={1}
        step={0.005}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(value) => onTransform({ ...transform, x: value }, t.inspector.positionX)}
        keyframe={xKeyframe}
      />
      <SliderRow
        label={t.inspector.positionY}
        value={transform.y}
        min={-1}
        max={1}
        step={0.005}
        format={(value) => `${Math.round(value * 100)}%`}
        onCommit={(value) => onTransform({ ...transform, y: value }, t.inspector.positionY)}
        keyframe={yKeyframe}
      />
      <div className="inspector__actions">
        <ToolButton
          label={t.inspector.resetTransform}
          variant="outline"
          onClick={() => onTransform({ ...DEFAULT_CLIP_TRANSFORM }, t.inspector.resetTransform)}
        />
      </div>
    </>
  )
}
