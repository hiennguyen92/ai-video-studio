import type { JSX } from 'react'
import {
  EXPORT_PRESETS,
  findExportPreset,
  type ExportQuality
} from '../../../../shared/domain/export-presets'
import { markerSections } from '../../../../shared/domain/export-range'
import type { ExportOutputChoice, RangeKey } from './export-output-choice'
import {
  ASPECT_RATIO_DIMENSIONS,
  type ProjectDocument
} from '../../../../shared/domain/project-document-types'
import { useEditorStore } from '../../state/editor-store'
import { ToolButton } from '../ui/tool-button'
import { formatClockTime } from '../../../../shared/domain/time-units'
import { interpolate, useT } from '../../i18n/use-translation'

/**
 * Mẫu xuất, chất lượng và đoạn xuất — tách khỏi hộp thoại Xuất cho gọn.
 *
 * Mẫu chỉ ĐIỀN SẴN các ô khác (độ phân giải, fps, âm lượng, chất lượng); người
 * dùng vẫn sửa được từng ô sau đó. Mẫu không đổi khung dự án: khung lệch thì
 * nói ra, để người dùng đổi khung ở nơi họ nhìn thấy chữ và clip dời theo.
 */

export function ExportOutputOptions({
  document,
  durationUs,
  choice,
  disabled,
  onChange,
  onApplyPreset
}: {
  document: ProjectDocument
  durationUs: number
  choice: ExportOutputChoice
  disabled: boolean
  onChange(patch: Partial<ExportOutputChoice>): void
  /** Mẫu vừa chọn — hộp thoại điền độ phân giải, fps và âm lượng theo nó. */
  onApplyPreset(presetId: string): void
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const preset = findExportPreset(choice.presetId)
  const aspectMismatch = preset && preset.aspect !== document.settings.aspectRatio
  const sections = markerSections(document.markers, durationUs)
  const presetLabel: Record<string, string> = {
    'vertical-short': t.export.presetVertical,
    youtube: t.export.presetYoutube,
    square: t.export.presetSquare
  }

  return (
    <>
      <div className="field-row">
        <span className="field-row__label">{t.export.preset}</span>
        <select
          value={choice.presetId}
          disabled={disabled}
          aria-label={t.export.preset}
          onChange={(event) => onApplyPreset(event.target.value)}
        >
          <option value="custom">{t.export.presetCustom}</option>
          {EXPORT_PRESETS.map((item) => (
            <option key={item.id} value={item.id}>
              {presetLabel[item.id]}
            </option>
          ))}
        </select>
      </div>
      {aspectMismatch && (
        <div className="notice notice--warning" role="status">
          <span>
            {interpolate(t.export.presetAspectMismatch, {
              preset: preset.aspect,
              project: document.settings.aspectRatio
            })}
          </span>
          {/*
            Đổi ngay tại đây, cùng bảng kích thước với ô chọn khung trên preview —
            bắt người dùng đóng hộp thoại đi tìm ô đó là thêm một chỗ để lạc.
          */}
          <ToolButton
            label={interpolate(t.export.presetSwitchAspect, { preset: preset.aspect })}
            variant="outline"
            disabled={disabled}
            onClick={() => {
              const { width, height } = ASPECT_RATIO_DIMENSIONS[preset.aspect]
              run(
                [
                  {
                    type: 'project/set-settings',
                    settings: { aspectRatio: preset.aspect, width, height }
                  }
                ],
                t.preview.aspectRatio
              )
            }}
          />
        </div>
      )}

      <div className="field-row">
        <span className="field-row__label">{t.export.quality}</span>
        <select
          value={choice.quality}
          disabled={disabled}
          aria-label={t.export.quality}
          onChange={(event) => onChange({ quality: event.target.value as ExportQuality })}
        >
          <option value="high">{t.export.qualityHigh}</option>
          <option value="standard">{t.export.qualityStandard}</option>
          <option value="compact">{t.export.qualityCompact}</option>
        </select>
      </div>

      <div className="field-row">
        <span className="field-row__label">{t.export.range}</span>
        <select
          value={choice.rangeKey}
          disabled={disabled}
          aria-label={t.export.range}
          onChange={(event) => onChange({ rangeKey: event.target.value as RangeKey })}
        >
          <option value="all">{t.export.rangeAll}</option>
          {sections.map((section, index) => (
            <option key={section.markerId} value={`marker:${section.markerId}`}>
              {`${section.label.trim() || interpolate(t.timeline.markerChapterUntitled, { index: index + 1 })} (${formatClockTime(section.startUs, false)}–${formatClockTime(section.endUs, false)})`}
            </option>
          ))}
          <option value="custom">{t.export.rangeCustom}</option>
        </select>
      </div>
      {choice.rangeKey === 'custom' && (
        <div className="field-row">
          <span className="field-row__label">{t.export.rangeFromTo}</span>
          <div className="export-dialog__inline">
            <input
              type="number"
              min={0}
              step={0.1}
              value={choice.customFromSeconds}
              disabled={disabled}
              aria-label={t.export.rangeFrom}
              onChange={(event) => onChange({ customFromSeconds: Number(event.target.value) || 0 })}
            />
            <input
              type="number"
              min={0}
              step={0.1}
              value={choice.customToSeconds}
              disabled={disabled}
              aria-label={t.export.rangeTo}
              onChange={(event) => onChange({ customToSeconds: Number(event.target.value) || 0 })}
            />
          </div>
        </div>
      )}
    </>
  )
}
