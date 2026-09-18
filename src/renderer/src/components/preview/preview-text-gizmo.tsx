import { useCallback, useLayoutEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import {
  dragTextPosition,
  pointerRotationDeg,
  type TextPosition
} from '../../../../shared/domain/text-placement'
import { scaledSizeFromBounds } from '../../../../shared/domain/clip-frame-fit'
import { useEditorStore } from '../../state/editor-store'
import {
  textFrameEdgeAxis,
  textFramePaddingScaleFromEdgeDrag,
  type TextFrameEdge
} from '../../../../shared/domain/text-frame-edge-drag'
import { useT } from '../../i18n/use-translation'
import { resolveGizmoTarget } from './use-gizmo-target'
import { PreviewGizmoFrameEdgeHandles } from './preview-gizmo-frame-edge-handles'

/**
 * Khung điều khiển vẽ ĐÈ lên khung xem trước cho thứ đang chọn.
 *
 * Kéo trong khung để dời, kéo tay nắm tròn phía trên để xoay, kéo góc dưới-phải
 * để đổi cỡ. Dùng cho cả chữ lẫn clip hình/ảnh — hai loại nằm hai chỗ trong tài
 * liệu và ghi bằng hai lệnh khác nhau, nhưng thao tác chuột thì y hệt nhau.
 *
 * Hai điều đáng nói:
 *
 *   - Trong lúc kéo, chỉ KHUNG chạy theo chuột, nội dung đứng yên rồi nhảy tới
 *     lúc thả. Đổi document theo từng sự kiện chuột sẽ nhồi hàng trăm bước vào
 *     lịch sử hoàn tác — cùng lối đã dùng cho kéo clip trên timeline.
 *   - Với CHỮ, kéo hay xoay đều ghim vào một vị trí tự do, kể cả khi chỉ xoay. Có
 *     ghim thì tâm xoay mới là tâm khối, đúng thứ tay nắm gợi ý; không ghim thì
 *     ASS xoay quanh điểm neo alignment và chữ văng đi một quãng.
 */

/** Bốn góc của khung, theo thứ tự trên-trái → dưới-phải. */
const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

const MIN_SCALE = 0.1
const MAX_SCALE = 4

interface GizmoBox {
  /** Bộ chọn đã đo. Đổi thứ đang chọn mà chưa đo lại thì số cũ không được vẽ. */
  selector: string
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
    left.selector === right.selector &&
    Math.abs(left.centerXPx - right.centerXPx) < 0.5 &&
    Math.abs(left.centerYPx - right.centerYPx) < 0.5 &&
    Math.abs(left.widthPx - right.widthPx) < 0.5 &&
    Math.abs(left.heightPx - right.heightPx) < 0.5 &&
    Math.abs(left.stageWidthPx - right.stageWidthPx) < 0.5 &&
    Math.abs(left.stageHeightPx - right.stageHeightPx) < 0.5
  )
}

type DragMode = 'move' | 'rotate' | 'resize' | 'pad'

interface DragState {
  mode: DragMode
  pointerStartX: number
  pointerStartY: number
  /** Khoảng cách từ tâm tới con trỏ lúc bắt đầu kéo góc. */
  grabRadiusPx: number
  startScale: number
  startPosition: TextPosition
  position: TextPosition
  rotationDeg: number
  scale: number
  /** Mép đang kéo, chỉ có ở chế độ `pad`. */
  edge?: TextFrameEdge
  /** Hệ số đệm khung của trục đang kéo, lúc bắt đầu và hiện tại. */
  startPadScale: number
  padScale: number
}

/** Hệ số đệm hiện tại của trục ứng với mép, hoặc 1 khi không kéo mép. */
function padScaleOf(target: ReturnType<typeof resolveGizmoTarget>, edge?: TextFrameEdge): number {
  if (!edge || !target?.framePadding) return 1
  return textFrameEdgeAxis(edge) === 'x' ? target.framePadding.scaleX : target.framePadding.scaleY
}

/**
 * Kích thước khung điều khiển trong lúc kéo: phóng theo góc, hoặc nới theo mép.
 *
 * Kéo mép thì chỉ trục đó đổi, mỗi bên thêm đúng phần đệm tăng thêm — khung chạy
 * theo con trỏ ngay, còn chữ thật nhảy tới lúc thả, cùng lối với các kiểu kéo khác.
 */
function padResizedSize(
  measured: GizmoBox,
  drag: DragState,
  target: ReturnType<typeof resolveGizmoTarget>,
  compositionWidthPx: number
): { widthPx: number; heightPx: number } {
  if (drag.mode === 'pad' && drag.edge && target?.framePadding) {
    const axis = textFrameEdgeAxis(drag.edge)
    const screenPerComposition = measured.stageWidthPx / compositionWidthPx
    const grow =
      2 *
      (drag.padScale - drag.startPadScale) *
      target.framePadding.basePaddingPx[axis] *
      screenPerComposition
    return axis === 'x'
      ? { widthPx: Math.max(1, measured.widthPx + grow), heightPx: measured.heightPx }
      : { widthPx: measured.widthPx, heightPx: Math.max(1, measured.heightPx + grow) }
  }
  const ratio = drag.scale / (target?.scale ?? 1)
  return { widthPx: measured.widthPx * ratio, heightPx: measured.heightPx * ratio }
}

export function PreviewTextGizmo({ document }: { document: ProjectDocument }): JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const selection = useEditorStore((state) => state.selection)
  const isPlaying = useEditorStore((state) => state.isPlaying)

  const [box, setBox] = useState<GizmoBox | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const target = resolveGizmoTarget(document, selection)
  const selector = target?.selector
  // Vòng đo cần góc xoay để suy ngược kích thước thật từ hộp bao. Nhận nó làm
  // phụ thuộc thay vì nhét vào ref: góc chỉ đổi khi người dùng thả chuột, nên
  // vòng đo khởi động lại đúng một lần, còn đọc ref trong lúc dựng là vi phạm
  // quy tắc của React.
  const targetRotationDeg = target?.rotationDeg ?? 0

  // Số đo phải là của ĐÚNG thứ đang chọn và phải còn hiệu lực (không đang phát),
  // nếu không khung điều khiển sẽ loé lên ở chỗ của thứ trước đó.
  const measured = box && box.selector === selector && !isPlaying ? box : null

  /**
   * Đo phần tử THẬT trên màn hình thay vì tự tính lại chỗ của nó: chỗ đó là kết
   * quả của bố cục, cỡ chữ, tỉ lệ ảnh và mức phóng của Player — tính lại là dựng
   * một bản sao của trình bày, và bản sao sẽ trôi khỏi bản gốc.
   *
   * Đo theo TỪNG KHUNG HÌNH chứ không đo một lần mỗi khi state đổi. Player vẽ
   * lại theo nhịp riêng, nên ngay sau một lần sửa, phần tử có thể chưa có mặt
   * trong DOM — đo đúng lúc đó là kết luận "không có gì để kéo" rồi khung điều
   * khiển biến mất hẳn, vì không còn gì kích hoạt một lần đo nữa.
   *
   * Không xoá số đo cũ khi dừng đo: xoá tức là gọi setState thẳng trong thân hiệu
   * ứng, và mỗi lượt dựng lại kéo theo một lượt nữa. Thay vào đó, số đo mang theo
   * bộ chọn của chính nó và lúc vẽ chỉ dùng khi còn khớp.
   */
  useLayoutEffect(() => {
    if (!selector || isPlaying) return

    let frame = 0
    const measure = (): void => {
      frame = requestAnimationFrame(measure)

      const root = rootRef.current
      if (!root) return
      const stage = root.getBoundingClientRect()
      const node = root.parentElement?.querySelector<HTMLElement>(selector)
      // Không nằm trong khoảng thời gian đang xem — không có gì để kéo.
      if (!node || stage.width === 0) {
        setBox((current) => (current === null ? current : null))
        return
      }

      const rect = node.getBoundingClientRect()
      // Suy kích thước thật từ hộp bao. Lấy thẳng `offsetWidth` là lấy kích
      // thước BỐ CỤC, mà `transform: scale()` không đụng tới bố cục — phóng to
      // ảnh xong khung điều khiển vẫn y nguyên. Lấy thẳng hộp bao thì với phần
      // tử đã xoay, khung phình ra to hơn chính nó.
      const size = scaledSizeFromBounds(
        { width: rect.width, height: rect.height },
        { width: node.offsetWidth, height: node.offsetHeight },
        targetRotationDeg
      )
      const next: GizmoBox = {
        selector,
        // Tâm hộp bao ngoài chính là tâm phần tử sau khi xoay: xoay một hình chữ
        // nhật quanh điểm nào thì hộp bao của nó vẫn nhận tâm hình đó làm tâm.
        centerXPx: rect.left + rect.width / 2 - stage.left,
        centerYPx: rect.top + rect.height / 2 - stage.top,
        widthPx: size.width,
        heightPx: size.height,
        stageWidthPx: stage.width,
        stageHeightPx: stage.height
      }
      setBox((current) => (current && sameBox(current, next) ? current : next))
    }

    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [selector, isPlaying, targetRotationDeg, document.settings.width])

  const beginDrag = useCallback(
    (event: PointerEvent<HTMLElement>, mode: DragMode, edge?: TextFrameEdge) => {
      const root = rootRef.current
      if (!root || !measured || !target) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)

      const stage = root.getBoundingClientRect()
      // Chưa đặt vị trí bao giờ thì lấy chính chỗ nó đang đứng làm điểm xuất
      // phát, để cú kéo đầu tiên không làm nó nhảy đi đâu cả.
      const startPosition = target.position ?? {
        xPct: measured.centerXPx / stage.width,
        yPct: measured.centerYPx / stage.height
      }
      const dx = event.clientX - (stage.left + measured.centerXPx)
      const dy = event.clientY - (stage.top + measured.centerYPx)

      setDrag({
        mode,
        pointerStartX: event.clientX,
        pointerStartY: event.clientY,
        grabRadiusPx: Math.max(1, Math.hypot(dx, dy)),
        startScale: target.scale ?? 1,
        startPosition,
        position: startPosition,
        rotationDeg: target.rotationDeg,
        scale: target.scale ?? 1,
        edge,
        startPadScale: padScaleOf(target, edge),
        padScale: padScaleOf(target, edge)
      })
    },
    [measured, target]
  )

  const moveDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const root = rootRef.current
      if (!drag || !root || !measured) return
      const stage = root.getBoundingClientRect()
      const centerX = stage.left + measured.centerXPx
      const centerY = stage.top + measured.centerYPx

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

      if (drag.mode === 'pad' && drag.edge && target?.framePadding) {
        const axis = textFrameEdgeAxis(drag.edge)
        setDrag({
          ...drag,
          padScale: textFramePaddingScaleFromEdgeDrag({
            edge: drag.edge,
            startScale: drag.startPadScale,
            deltaXPx: event.clientX - drag.pointerStartX,
            deltaYPx: event.clientY - drag.pointerStartY,
            rotationDeg: drag.rotationDeg,
            basePaddingPx: target.framePadding.basePaddingPx[axis],
            screenPxPerCompositionPx: stage.width / document.settings.width
          })
        })
        return
      }

      if (drag.mode === 'resize') {
        // Tỉ lệ khoảng cách tới tâm: kéo ra xa gấp đôi thì to gấp đôi. Đo theo
        // khoảng cách chứ không theo trục ngang, để còn đúng khi đang xoay.
        const radius = Math.hypot(event.clientX - centerX, event.clientY - centerY)
        const next = (drag.startScale * radius) / drag.grabRadiusPx
        setDrag({ ...drag, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)) })
        return
      }

      setDrag({
        ...drag,
        rotationDeg: pointerRotationDeg(centerX, centerY, event.clientX, event.clientY)
      })
    },
    [drag, measured, target, document.settings.width]
  )

  const endDrag = useCallback(() => {
    if (!drag || !target) return
    setDrag(null)
    if (drag.mode === 'pad') {
      // Nhấp mà không kéo thì không ghi gì: một bước hoàn tác rỗng trông như lỗi.
      if (!drag.edge || !target.framePadding || drag.padScale === drag.startPadScale) return
      const axis = textFrameEdgeAxis(drag.edge)
      target.framePadding.write(
        axis,
        drag.padScale,
        axis === 'x' ? t.preview.framePaddingX : t.preview.framePaddingY
      )
      return
    }
    const labels: Record<Exclude<DragMode, 'pad'>, string> = {
      move: t.preview.moveText,
      rotate: t.preview.rotateText,
      resize: t.preview.resizeText
    }
    target.write(
      { position: drag.position, rotationDeg: drag.rotationDeg, scale: drag.scale },
      labels[drag.mode]
    )
  }, [drag, target, t.preview])

  /**
   * Kẹp khung điều khiển vào trong khung xem trước.
   *
   * Nội dung to hơn khung hình thì hộp bao của nó thò ra ngoài, và tay nắm nằm ở
   * góc hộp sẽ rơi ra ngoài vùng xem trước — đo được: thanh tiêu đề của app chặn
   * luôn cú bấm, không tài nào xoay hay đổi cỡ được nữa.
   *
   * Kẹp lại thì khung ôm đúng phần NHÌN THẤY, và mọi tay nắm luôn bấm tới được.
   *
   * Kẹp ĐÚNG mép khung hình, không chừa thêm lề. Chừa lề thì clip phủ kín khung
   * hình cũng bị vẽ một cái khung thụt vào trong — trông như clip không phủ hết.
   * Bản thân tay nắm được phép lòi ra ngoài: vùng xem trước có sẵn khoảng đệm
   * quanh khung hình và lớp phủ không cắt, nên lòi ra vẫn thấy và vẫn bấm được.
   */
  const clampToStage = (value: GizmoBox): GizmoBox => {
    const left = Math.max(0, value.centerXPx - value.widthPx / 2)
    const top = Math.max(0, value.centerYPx - value.heightPx / 2)
    const right = Math.min(value.stageWidthPx, value.centerXPx + value.widthPx / 2)
    const bottom = Math.min(value.stageHeightPx, value.centerYPx + value.heightPx / 2)
    if (right <= left || bottom <= top) return value
    return {
      ...value,
      centerXPx: (left + right) / 2,
      centerYPx: (top + bottom) / 2,
      widthPx: right - left,
      heightPx: bottom - top
    }
  }

  const shown = !measured
    ? null
    : clampToStage(
        drag
          ? {
              ...measured,
              centerXPx: drag.position.xPct * measured.stageWidthPx,
              centerYPx: drag.position.yPct * measured.stageHeightPx,
              ...padResizedSize(measured, drag, target, document.settings.width)
            }
          : measured
      )
  const rotation = drag?.rotationDeg ?? target?.rotationDeg ?? 0

  const readout = drag
    ? drag.mode === 'move'
      ? `${Math.round(drag.position.xPct * 100)}% · ${Math.round(drag.position.yPct * 100)}%`
      : drag.mode === 'resize' || drag.mode === 'pad'
        ? `${Math.round((drag.mode === 'pad' ? drag.padScale : drag.scale) * 100)}%`
        : `${drag.rotationDeg}°`
    : null

  const handlers = {
    onPointerMove: moveDrag,
    onPointerUp: endDrag,
    onPointerCancel: endDrag
  }

  // Vẫn phải dựng thẻ gốc kể cả khi không có gì để vẽ: hiệu ứng đo ở trên cần nó
  // để biết khung xem trước rộng bao nhiêu.
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
          {...handlers}
        >
          <span
            className="preview-gizmo__rotate"
            role="button"
            tabIndex={0}
            aria-label={t.preview.rotateText}
            onPointerDown={(event) => beginDrag(event, 'rotate')}
            {...handlers}
          />

          {/* BỐN góc, không phải một. Một ô nhỏ nằm lọt trong hình thì không ai
              nhận ra đó là chỗ để kéo — người dùng với tay ra góc nào cũng phải
              gặp tay nắm ở đó.
              
              Chữ không có bộ này: chữ đổi cỡ bằng cỡ phông, và bày ra một tay
              nắm không làm gì là tệ hơn không có. */}
          {target.scale !== null &&
            CORNERS.map((corner) => (
              <span
                key={corner}
                className={`preview-gizmo__resize preview-gizmo__resize--${corner}`}
                role="button"
                tabIndex={0}
                aria-label={t.preview.resizeText}
                onPointerDown={(event) => beginDrag(event, 'resize')}
                {...handlers}
              />
            ))}

          {target.framePadding && (
            <PreviewGizmoFrameEdgeHandles
              onBegin={(event, edge) => beginDrag(event, 'pad', edge)}
              handlers={handlers}
            />
          )}

          {readout && <span className="preview-gizmo__readout">{readout}</span>}
        </div>
      )}
    </div>
  )
}
