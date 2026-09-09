import { useCallback, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import type { SubtitleStyle } from '../../../../shared/domain/subtitle-types'
import type { TextBlockRef } from '../../../../shared/domain/text-block-drag'
import {
  dragTextPosition,
  pointerRotationDeg,
  type TextPosition
} from '../../../../shared/domain/text-placement'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'

/**
 * Khung điều khiển vẽ ĐÈ lên khung xem trước cho khối chữ đang chọn.
 *
 * Kéo trong khung để dời chữ, kéo tay nắm phía trên để xoay. Đây là cách duy
 * nhất đặt chữ vào một chỗ bất kỳ: chín ô alignment cộng ba con số lề không tả
 * được "ngay trên vai người trong hình".
 *
 * Hai điều đáng nói:
 *
 *   - Trong lúc kéo, chỉ KHUNG chạy theo chuột, chữ đứng yên rồi nhảy tới lúc
 *     thả. Đổi document theo từng sự kiện chuột sẽ nhồi hàng trăm bước vào lịch
 *     sử hoàn tác — cùng lối đã dùng cho kéo clip và kéo khối chữ trên timeline.
 *   - Kéo hay xoay đều GHIM chữ vào một vị trí tự do, kể cả khi chỉ xoay. Có ghim
 *     thì tâm xoay mới là tâm khối, đúng thứ tay nắm gợi ý; không ghim thì ASS
 *     xoay quanh điểm neo alignment và chữ văng đi một quãng.
 */

interface GizmoBox {
  /** Khối đã đo. Đổi khối mà chưa đo lại thì số cũ không được đem ra vẽ. */
  blockId: string
  centerXPx: number
  centerYPx: number
  widthPx: number
  heightPx: number
  /** Kích thước khung xem trước lúc đo. Giữ ở đây để lúc vẽ khỏi đọc lại DOM. */
  stageWidthPx: number
  stageHeightPx: number
}

/** Lệch dưới nửa pixel thì coi như không đổi — đủ để không dựng lại mỗi khung. */
function sameBox(left: GizmoBox, right: GizmoBox): boolean {
  return (
    Math.abs(left.centerXPx - right.centerXPx) < 0.5 &&
    Math.abs(left.centerYPx - right.centerYPx) < 0.5 &&
    Math.abs(left.widthPx - right.widthPx) < 0.5 &&
    Math.abs(left.heightPx - right.heightPx) < 0.5 &&
    Math.abs(left.stageWidthPx - right.stageWidthPx) < 0.5 &&
    Math.abs(left.stageHeightPx - right.stageHeightPx) < 0.5
  )
}

interface DragState {
  mode: 'move' | 'rotate'
  pointerStartX: number
  pointerStartY: number
  startPosition: TextPosition
  position: TextPosition
  rotationDeg: number
}

/** Kiểu và lệnh ghi cho khối chữ đang chọn — hai loại đi hai đường khác nhau. */
function resolveBlock(
  document: ProjectDocument,
  block: TextBlockRef
): { id: string; style: SubtitleStyle; write(style: SubtitleStyle, label: string): void } | null {
  const run = useEditorStore.getState().run

  if (block.kind === 'overlay') {
    const overlay = document.textOverlays.find((item) => item.id === block.overlayId)
    if (!overlay) return null
    return {
      id: overlay.id,
      style: overlay.style,
      write: (style, label) =>
        void run([{ type: 'text/set-style', overlayId: overlay.id, style }], label)
    }
  }

  const track = document.subtitleTracks.find((item) => item.id === block.subtitleTrackId)
  const cue = track?.cues.find((item) => item.id === block.cueId)
  if (!track || !cue) return null
  return {
    id: cue.id,
    style: track.style,
    // Kiểu chữ phụ đề thuộc về CẢ track, nên kéo một câu là dời mọi câu. Panel
    // thuộc tính nói rõ điều đó ngay bên cạnh.
    write: (style, label) =>
      void run([{ type: 'subtitle/set-style', trackId: track.id, style }], label)
  }
}

export function PreviewTextGizmo({ document }: { document: ProjectDocument }): JSX.Element | null {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedBlock = useEditorStore((state) => state.selection.text)
  const isPlaying = useEditorStore((state) => state.isPlaying)

  const [box, setBox] = useState<GizmoBox | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const target = selectedBlock ? resolveBlock(document, selectedBlock) : null
  const blockId = target?.id

  // Số đo phải là của ĐÚNG khối đang chọn và phải còn hiệu lực (không đang phát),
  // nếu không khung điều khiển sẽ loé lên ở chỗ của khối trước đó.
  const measured = box && box.blockId === blockId && !isPlaying ? box : null

  // Đo khối chữ THẬT trên màn hình thay vì tự tính lại chỗ của nó: chỗ đó là kết
  // quả của alignment, lề, ngắt dòng, cỡ chữ và cả phông đang dùng — tính lại là
  // dựng một bản sao của trình bày, và bản sao sẽ trôi khỏi bản gốc.
  //
  // Đo theo TỪNG KHUNG HÌNH chứ không đo một lần mỗi khi state đổi. Player vẽ
  // lại theo nhịp riêng của nó, nên ngay sau một lần sửa, khối chữ có thể chưa
  // có mặt trong DOM — đo đúng lúc đó là kết luận "không có gì để kéo" rồi khung
  // điều khiển biến mất hẳn, vì không còn gì kích hoạt một lần đo nữa.
  //
  // Chỉ gọi setState khi số đo THẬT SỰ đổi, nếu không mỗi khung hình là một lần
  // dựng lại vô ích.
  //
  // Không xoá số đo cũ khi dừng đo: xoá tức là gọi setState thẳng trong thân
  // hiệu ứng, và mỗi lượt dựng lại kéo theo một lượt nữa. Thay vào đó, số đo mang
  // theo id khối của chính nó và lúc vẽ chỉ dùng khi id còn khớp.
  useLayoutEffect(() => {
    if (!blockId || isPlaying) return

    let frame = 0
    const measure = (): void => {
      frame = requestAnimationFrame(measure)

      const root = rootRef.current
      if (!root) return
      const stage = root.getBoundingClientRect()
      const node = root.parentElement?.querySelector<HTMLElement>(
        `[data-block-id="${blockId}"] .text-block`
      )
      // Chữ không nằm trong khoảng thời gian đang xem — không có gì để kéo.
      if (!node || stage.width === 0) {
        setBox((current) => (current === null ? current : null))
        return
      }

      const rect = node.getBoundingClientRect()
      // Player co cả composition lại cho vừa khung, nên bề rộng bố cục của khối
      // (`offsetWidth`) tính bằng pixel của composition, không phải pixel màn hình.
      const scale = stage.width / document.settings.width
      const next: GizmoBox = {
        blockId,
        // Tâm hộp bao ngoài chính là tâm khối sau khi xoay: xoay một hình chữ
        // nhật quanh điểm nào thì hộp bao của nó vẫn nhận tâm hình đó làm tâm.
        centerXPx: rect.left + rect.width / 2 - stage.left,
        centerYPx: rect.top + rect.height / 2 - stage.top,
        widthPx: node.offsetWidth * scale,
        heightPx: node.offsetHeight * scale,
        stageWidthPx: stage.width,
        stageHeightPx: stage.height
      }
      setBox((current) => (current && sameBox(current, next) ? current : next))
    }

    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [blockId, isPlaying, document.settings.width])

  const beginDrag = useCallback(
    (event: PointerEvent<HTMLElement>, mode: 'move' | 'rotate') => {
      const root = rootRef.current
      if (!root || !measured || !target) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      const stage = root.getBoundingClientRect()
      // Chưa ghim bao giờ thì lấy chính chỗ chữ đang đứng làm điểm xuất phát, để
      // cú kéo đầu tiên không làm chữ nhảy đi đâu cả.
      const startPosition = target.style.position ?? {
        xPct: measured.centerXPx / stage.width,
        yPct: measured.centerYPx / stage.height
      }

      setDrag({
        mode,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        startPosition,
        position: startPosition,
        rotationDeg: target.style.rotationDeg ?? 0
      })
    },
    [measured, target]
  )

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const root = rootRef.current
      if (!drag || !root || !measured) return
      const stage = root.getBoundingClientRect()

      if (drag.mode === 'move') {
        setDrag({
          ...drag,
          position: dragTextPosition(
            drag.startPosition,
            event.clientX - drag.pointerStartX,
            event.clientY - drag.pointerStartY,
            stage.width,
            stage.height
          )
        })
        return
      }

      setDrag({
        ...drag,
        rotationDeg: pointerRotationDeg(
          stage.left + measured.centerXPx,
          stage.top + measured.centerYPx,
          event.clientX,
          event.clientY
        )
      })
    },
    [drag, measured]
  )

  const endDrag = useCallback(() => {
    if (!drag || !target) return
    setDrag(null)
    target.write(
      { ...target.style, position: drag.position, rotationDeg: drag.rotationDeg },
      drag.mode === 'move' ? 'Dời chữ' : 'Xoay chữ'
    )
  }, [drag, target])

  // Vẫn phải dựng thẻ gốc kể cả khi không có gì để vẽ: hiệu ứng đo ở trên cần nó
  // để biết khung xem trước rộng bao nhiêu.
  const shown =
    measured && drag
      ? {
          ...measured,
          centerXPx: drag.position.xPct * measured.stageWidthPx,
          centerYPx: drag.position.yPct * measured.stageHeightPx
        }
      : measured
  const rotation = drag?.rotationDeg ?? target?.style.rotationDeg ?? 0

  return (
    <div ref={rootRef} className="preview-gizmo-layer">
      {shown && target && (
        <div
          className={`preview-gizmo ${drag ? 'preview-gizmo--dragging' : ''}`}
          style={{
            left: shown.centerXPx,
            top: shown.centerYPx,
            width: shown.widthPx,
            height: shown.heightPx,
            transform: `translate(-50%, -50%) rotate(${rotation}deg)`
          }}
          role="button"
          tabIndex={0}
          aria-label={t.preview.moveText}
          title={t.preview.moveTextHint}
          onPointerDown={(event) => beginDrag(event, 'move')}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span
            className="preview-gizmo__rotate"
            role="button"
            tabIndex={0}
            aria-label={t.preview.rotateText}
            onPointerDown={(event) => beginDrag(event, 'rotate')}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {drag && (
            <span className="preview-gizmo__readout">
              {drag.mode === 'move'
                ? `${Math.round(drag.position.xPct * 100)}% · ${Math.round(drag.position.yPct * 100)}%`
                : `${drag.rotationDeg}°`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
