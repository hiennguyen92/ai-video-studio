import type { JSX } from 'react'
import {
  ASPECT_RATIO_DIMENSIONS,
  type AspectRatio,
  type ProjectSettings
} from '../../../../shared/domain/project-document-types'
import { FRAME_RATE_PRESETS, frameRateToNumber } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'

/**
 * Đổi khung hình của dự án SAU khi đã tạo.
 *
 * Trước đây tỉ lệ khung chỉ chọn được đúng một lần, lúc tạo dự án — chọn nhầm
 * 16:9 cho một video dọc là phải dựng lại dự án từ đầu. Lệnh đổi thì đã có từ
 * lâu, chỉ agent gọi được qua công cụ `set_canvas`; nghĩa là người dùng phải
 * dựng nổi một máy chủ LLM mới sửa được một ô chọn.
 *
 * Đặt ngay trên đầu khung xem trước, nơi vốn đã hiển thị tỉ lệ và kích thước —
 * chỗ người ta nhìn vào khi nhận ra mình chọn nhầm.
 */
export function PreviewCanvasSettings({ settings }: { settings: ProjectSettings }): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)

  const setAspectRatio = (aspectRatio: AspectRatio): void => {
    // Kích thước đi theo tỉ lệ, lấy từ cùng bảng mà lúc tạo dự án dùng: để hai
    // đường không cho ra hai bộ số khác nhau cho cùng một tỉ lệ.
    const { width, height } = ASPECT_RATIO_DIMENSIONS[aspectRatio]
    run(
      [{ type: 'project/set-settings', settings: { aspectRatio, width, height } }],
      t.preview.aspectRatio
    )
  }

  const setFrameRate = (key: string): void => {
    const frameRate = FRAME_RATE_PRESETS[key]
    if (!frameRate) return
    run([{ type: 'project/set-settings', settings: { frameRate } }], t.preview.frameRate)
  }

  const currentFps = String(
    Object.keys(FRAME_RATE_PRESETS).find(
      (key) =>
        FRAME_RATE_PRESETS[key].num === settings.frameRate.num &&
        FRAME_RATE_PRESETS[key].den === settings.frameRate.den
    ) ?? frameRateToNumber(settings.frameRate)
  )

  return (
    <span className="preview__canvas">
      <select
        className="preview__canvas-select"
        aria-label={t.preview.aspectRatio}
        title={t.preview.aspectRatio}
        value={settings.aspectRatio}
        onChange={(event) => setAspectRatio(event.target.value as AspectRatio)}
      >
        {(Object.keys(ASPECT_RATIO_DIMENSIONS) as AspectRatio[]).map((ratio) => (
          <option key={ratio} value={ratio}>
            {ratio}
          </option>
        ))}
      </select>
      <select
        className="preview__canvas-select"
        aria-label={t.preview.frameRate}
        title={t.preview.frameRate}
        value={currentFps}
        onChange={(event) => setFrameRate(event.target.value)}
      >
        {Object.keys(FRAME_RATE_PRESETS).map((key) => (
          <option key={key} value={key}>
            {key} fps
          </option>
        ))}
      </select>
      <span className="preview__canvas-size">
        {settings.width}×{settings.height}
      </span>
    </span>
  )
}
