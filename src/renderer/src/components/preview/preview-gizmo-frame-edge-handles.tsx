import type { JSX, PointerEvent } from 'react'
import type { TextFrameEdge } from '../../../../shared/domain/text-frame-edge-drag'
import { useT } from '../../i18n/use-translation'

const EDGES: TextFrameEdge[] = ['left', 'right', 'top', 'bottom']

/**
 * Bốn tay nắm giữa bốn mép, để kéo khung nền chữ rộng ra hoặc ôm sát chữ.
 *
 * Nằm GIỮA mép chứ không ở góc: góc đã là chỗ đổi cỡ của clip, và mép giữa là
 * chỗ người ta quen kéo để đổi một chiều. Chỉ hiện khi chữ có khung — tay nắm
 * không làm gì thì tệ hơn không có.
 */
export function PreviewGizmoFrameEdgeHandles({
  onBegin,
  handlers
}: {
  onBegin(event: PointerEvent<HTMLElement>, edge: TextFrameEdge): void
  handlers: {
    onPointerMove(event: PointerEvent<HTMLElement>): void
    onPointerUp(): void
    onPointerCancel(): void
  }
}): JSX.Element {
  const t = useT()
  return (
    <>
      {EDGES.map((edge) => (
        <span
          key={edge}
          className={`preview-gizmo__edge preview-gizmo__edge--${edge}`}
          role="button"
          tabIndex={0}
          aria-label={
            edge === 'left' || edge === 'right' ? t.preview.framePaddingX : t.preview.framePaddingY
          }
          onPointerDown={(event) => onBegin(event, edge)}
          {...handlers}
        />
      ))}
    </>
  )
}
