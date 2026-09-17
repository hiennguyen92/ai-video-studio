import { useState, type JSX } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import type { TextOverlay } from '../../../../shared/domain/text-overlay-types'
import { useT } from '../../i18n/use-translation'
import { TextOverlayEditor, type TextOverlayEditorTab } from '../ai-studio/text-overlay-editor'
import { EmptyState } from '../ui/empty-state'
import { SubtitleCueInspector } from './subtitle-cue-inspector'

/**
 * Panel thuộc tính cho một KHỐI CHỮ đang chọn trên timeline.
 *
 * Câu phụ đề: `SubtitleCueInspector`. Chữ đè hình: `TextOverlayEditor` — cùng
 * trình chỉnh với thẻ đang mở trong tab Text của AI Studio, nên hai chỗ không lệch.
 */

function OverlayInspector({ overlay }: { overlay: TextOverlay }): JSX.Element {
  const [tab, setTab] = useState<TextOverlayEditorTab>('basic')
  return (
    <div className="inspector">
      <TextOverlayEditor overlay={overlay} tab={tab} onTabChange={setTab} />
    </div>
  )
}

export function TextBlockInspector({
  document,
  block
}: {
  document: ProjectDocument
  block: TextBlockRef
}): JSX.Element {
  const t = useT()

  if (block.kind === 'subtitle') return <SubtitleCueInspector document={document} block={block} />

  const overlay = document.textOverlays.find((item) => item.id === block.overlayId)
  // Khối bị xoá trong lúc vẫn đang chọn: nói ra thay vì hiện một panel rỗng.
  if (!overlay)
    return (
      <EmptyState title={t.inspector.missingTextBlock} hint={t.inspector.missingTextBlockHint} />
    )
  return <OverlayInspector overlay={overlay} />
}
