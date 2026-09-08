import type { JSX } from 'react'
import {
  DEFAULT_MOTION_INTENSITY,
  type ClipMotion,
  type ClipMotionKind
} from '../../../../shared/domain/clip-motion-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'

/**
 * Chọn chuyển động chạy suốt clip đang chọn.
 *
 * Khác ô chuyển cảnh ngay bên trên: chuyển cảnh chỉ chạy ở chỗ nối hai clip, còn
 * cái này chạy hết độ dài clip. Đặt cạnh nhau vì người dùng hay nhầm hai thứ, và
 * nhìn thấy cả hai cùng lúc là cách phân biệt nhanh nhất.
 */

const KINDS: Array<{ value: ClipMotionKind; labelKey: string }> = [
  { value: 'zoom-in', labelKey: 'motionZoomIn' },
  { value: 'zoom-out', labelKey: 'motionZoomOut' },
  { value: 'pan-left', labelKey: 'motionPanLeft' },
  { value: 'pan-right', labelKey: 'motionPanRight' },
  { value: 'pan-up', labelKey: 'motionPanUp' },
  { value: 'pan-down', labelKey: 'motionPanDown' },
  { value: 'punch-in', labelKey: 'motionPunchIn' },
  { value: 'shake', labelKey: 'motionShake' }
]

export function ClipMotionControls({
  clip,
  onChange
}: {
  clip: Clip
  onChange(motion: ClipMotion | undefined): void
}): JSX.Element {
  const t = useT()
  const current = clip.motion

  return (
    <>
      <p className="field-group__title">{t.inspector.motion}</p>

      <div className="field-row">
        <span className="field-row__label">{t.inspector.motion}</span>
        <select
          value={current?.kind ?? ''}
          aria-label={t.inspector.motion}
          onChange={(event) => {
            const kind = event.target.value as ClipMotionKind | ''
            onChange(
              kind === ''
                ? undefined
                : { kind, intensity: current?.intensity ?? DEFAULT_MOTION_INTENSITY }
            )
          }}
        >
          <option value="">{t.inspector.motionNone}</option>
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {t.inspector[option.labelKey as keyof typeof t.inspector] as string}
            </option>
          ))}
        </select>
      </div>

      {current && (
        <div className="field-row">
          <span className="field-row__label">{t.inspector.motionIntensity}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={current.intensity}
            aria-label={t.inspector.motionIntensity}
            onChange={(event) =>
              onChange({ kind: current.kind, intensity: Number(event.target.value) })
            }
          />
          <span className="field-row__value">{Math.round(current.intensity * 100)}%</span>
        </div>
      )}

      {/*
        Lia máy phải phóng nền lên mới không lộ mép khung, nên hình bị cắt bớt một
        ít. Nói ra thay vì để người dùng tự phát hiện lúc xuất file.
      */}
      {current?.kind.startsWith('pan-') && (
        <p className="field-group__hint">{t.inspector.motionPanNote}</p>
      )}
    </>
  )
}
