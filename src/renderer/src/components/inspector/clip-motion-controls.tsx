import type { JSX } from 'react'
import {
  DEFAULT_MOTION_INTENSITY,
  type ClipMotion,
  type ClipMotionKind
} from '../../../../shared/domain/clip-motion-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { useT } from '../../i18n/use-translation'
import { LIBRARY_MOTION_KINDS } from '../../../../shared/domain/library-clip-effects'
import { MOTION_LABEL_KEYS } from '../library/clip-effect-labels'

/**
 * Chọn chuyển động chạy suốt clip đang chọn.
 *
 * Khác ô chuyển cảnh ngay bên trên: chuyển cảnh chỉ chạy ở chỗ nối hai clip, còn
 * cái này chạy hết độ dài clip. Đặt cạnh nhau vì người dùng hay nhầm hai thứ, và
 * nhìn thấy cả hai cùng lúc là cách phân biệt nhanh nhất.
 */

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
          {LIBRARY_MOTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {t.inspector[MOTION_LABEL_KEYS[kind]]}
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
        <p className="inspector__hint">{t.inspector.motionPanNote}</p>
      )}
    </>
  )
}
