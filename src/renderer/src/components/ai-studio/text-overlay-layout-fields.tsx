import type { JSX } from 'react'
import type { SubtitleAlignment } from '../../../../shared/domain/subtitle-types'
import { MAX_TEXT_ROTATION_DEG } from '../../../../shared/domain/text-placement'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { useEditorStore } from '../../state/editor-store'
import { SegmentedRow, StyleSliderRow } from './style-field-rows'
import { TextPositionRow } from './text-position-row'

/**
 * Tab Layout của một chữ: vị trí, góc xoay. Kéo chữ trên preview sẽ ghim vị trí —
 * hàng ghim đứng đầu, và ô vị trí mờ đi vì lúc đó không còn tác dụng.
 */
export function TextOverlayLayoutFields({
  overlay,
  label
}: {
  overlay: TextOverlay
  label(base: string): string
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const style = overlay.style
  const setStyle = (next: TextOverlay['style'], historyLabel: string): void => {
    run([{ type: 'text/set-style', overlayId: overlay.id, style: next }], historyLabel)
  }

  return (
    <>
      <TextPositionRow style={style} onChange={(next) => setStyle(next, 'Bỏ ghim chữ')} />

      <div className={style.position ? 'style-fields--overridden' : undefined}>
        <SegmentedRow<SubtitleAlignment>
          label={t.textOverlay.position}
          ariaLabel={label(t.textOverlay.position)}
          value={style.alignment}
          options={[
            { value: 8, label: t.textOverlay.positionTop },
            { value: 5, label: t.textOverlay.positionMiddle },
            { value: 2, label: t.textOverlay.positionBottom }
          ]}
          onChange={(alignment) =>
            setStyle(
              // Nằm giữa thì lề dọc vô nghĩa; đặt lại để chữ không lệch.
              { ...style, alignment, marginVerticalPx: alignment === 5 ? 0 : 160 },
              'Đổi vị trí chữ'
            )
          }
        />
      </div>

      <StyleSliderRow
        label={t.subtitles.rotation}
        ariaLabel={label(t.subtitles.rotation)}
        value={style.rotationDeg ?? 0}
        min={-MAX_TEXT_ROTATION_DEG}
        max={MAX_TEXT_ROTATION_DEG}
        format={(value) => `${value}°`}
        onChange={(value) => setStyle({ ...style, rotationDeg: value }, 'Xoay chữ')}
      />
    </>
  )
}
