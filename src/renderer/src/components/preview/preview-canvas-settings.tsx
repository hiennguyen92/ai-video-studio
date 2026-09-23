import type { JSX } from 'react'
import {
  CANVAS_SHORT_EDGES,
  canvasSizeForLongEdge,
  longEdgeForShortEdge,
  shortEdgeOf,
  type CanvasShortEdge
} from '../../../../shared/domain/canvas-size'
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

  const shortEdge = shortEdgeOf(settings)

  const resize = (aspectRatio: AspectRatio, shortEdgePx: number, label: string): void => {
    // Một phép tính duy nhất cho cả ô tỉ lệ, ô độ phân giải và công cụ `set_canvas`
    // của agent: ba đường tự tính lấy sẽ cho ba bộ số khác nhau cho cùng một khung.
    const size = canvasSizeForLongEdge(aspectRatio, longEdgeForShortEdge(aspectRatio, shortEdgePx))
    run([{ type: 'project/set-settings', settings: { aspectRatio, ...size } }], label)
  }

  // Đổi tỉ lệ GIỮ nguyên độ phân giải: đang dựng 4K mà đổi khung sang dọc rồi tụt
  // về 1080 là mất ba phần tư số điểm ảnh, không hỏi một câu nào.
  const setAspectRatio = (aspectRatio: AspectRatio): void =>
    resize(aspectRatio, shortEdge, t.preview.aspectRatio)

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
        aria-label={t.preview.resolution}
        title={t.preview.resolution}
        value={CANVAS_SHORT_EDGES.includes(shortEdge as CanvasShortEdge) ? shortEdge : 'custom'}
        onChange={(event) =>
          resize(settings.aspectRatio, Number(event.target.value), t.preview.resolution)
        }
      >
        {/* Độ phân giải lẻ (dự án cũ, hay nguồn cỡ lạ) vẫn phải hiện đúng trong ô,
            không thì ô nói một đằng còn khung dựng một nẻo. */}
        {!CANVAS_SHORT_EDGES.includes(shortEdge as CanvasShortEdge) && (
          <option value="custom" disabled>
            {shortEdge}p
          </option>
        )}
        {CANVAS_SHORT_EDGES.map((edge) => (
          <option key={edge} value={edge}>
            {edge}p{edge === 2160 ? ' · 4K' : ''}
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
