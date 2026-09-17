import type { JSX } from 'react'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { PanelSubtabs } from '../ui/panel-subtabs'
import { TextOverlayAnimationFields } from './text-overlay-animation-fields'
import { TextOverlayBasicFields } from './text-overlay-basic-fields'
import { TextOverlayLayoutFields } from './text-overlay-layout-fields'
import { TextOverlayStyleFields } from './text-overlay-style-fields'

export type TextOverlayEditorTab = 'basic' | 'style' | 'layout' | 'animation'

/**
 * Trình chỉnh MỘT chữ đè hình, chia tab con Basic / Style / Layout / Animation.
 *
 * Dùng chung cho thẻ đang mở trong tab Text của AI Studio và panel Thuộc tính khi
 * bấm khối chữ trên timeline — một bản duy nhất, thêm ô ở đây là có ở cả hai.
 */
export function TextOverlayEditor({
  overlay,
  index,
  tab,
  onTabChange,
  sticky = true
}: {
  overlay: TextOverlay
  /** Số thứ tự trong danh sách, gắn vào nhãn để trình đọc màn hình phân biệt. */
  index?: number
  tab: TextOverlayEditorTab
  onTabChange(tab: TextOverlayEditorTab): void
  /** Thanh tab bám mép trên vùng cuộn; tắt khi trình chỉnh nằm lồng trong một thẻ. */
  sticky?: boolean
}): JSX.Element {
  const t = useT()
  const label = (base: string): string => (index === undefined ? base : `${base} ${index + 1}`)

  return (
    <>
      <PanelSubtabs<TextOverlayEditorTab>
        label={label(t.inspector.textOverlay)}
        active={tab}
        onChange={onTabChange}
        sticky={sticky}
        tabs={[
          { key: 'basic', label: t.inspector.tabBasic },
          { key: 'style', label: t.inspector.tabStyle },
          { key: 'layout', label: t.inspector.tabLayout },
          { key: 'animation', label: t.inspector.tabAnimation }
        ]}
      />
      {tab === 'basic' && <TextOverlayBasicFields overlay={overlay} label={label} />}
      {tab === 'style' && <TextOverlayStyleFields overlay={overlay} label={label} />}
      {tab === 'layout' && <TextOverlayLayoutFields overlay={overlay} label={label} />}
      {tab === 'animation' && <TextOverlayAnimationFields overlay={overlay} label={label} />}
    </>
  )
}
