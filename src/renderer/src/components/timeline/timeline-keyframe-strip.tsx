import { useState, type JSX, type PointerEvent } from 'react'
import { keyframeMarkers, type KeyframeMarker } from '../../../../shared/domain/keyframe-markers'
import type { EditorCommand } from '../../../../shared/commands/editor-command-types'
import type { KeyframeEasing, KeyframeTracks } from '../../../../shared/domain/keyframe-types'
import type { Micros } from '../../../../shared/domain/time-units'
import { useEditorStore } from '../../state/editor-store'
import { useT } from '../../i18n/use-translation'
import { collectSnapTargets, pxToUs, snapTime, usToPx } from './timeline-geometry'
import { TimelineKeyframeMenu } from './timeline-keyframe-menu'
import './timeline-keyframe-strip.css'

/**
 * Dải chấm keyframe, phủ lên đáy clip đang chọn.
 *
 * Hai quyết định về chỗ đặt, cả hai đều do cấu trúc timeline ép:
 *
 *   - Là ANH EM của `TimelineClip`, không phải con của nó. `.timeline-clip` có
 *     `contain: paint` và `overflow: hidden` (xem `timeline-panel.css`), nên mọi
 *     thứ vẽ bên trong mà tràn ra đều bị cắt — đặt nhầm chỗ thì dải đơn giản là
 *     không hiện, và không có lỗi nào chỉ ra vì sao.
 *   - PHỦ lên clip chứ không chiếm một hàng riêng. Cột đầu track và cột lane là
 *     hai cây DOM riêng, khớp hàng với nhau chỉ nhờ cùng một con số chiều cao;
 *     thêm một hàng ở bên này mà quên bên kia là mọi hàng phía dưới lệch nhau.
 *     Phủ lên thì không phải đụng cột đầu track một dòng nào.
 *
 * Dải KHÔNG đọc đầu phát. Timeline vẽ lại theo đầu phát là thứ đã đo được làm
 * Player tụt khung, nên vị trí đầu phát chỉ được đọc một lần lúc bắt đầu kéo,
 * để bắt dính.
 */

export interface KeyframeStripTarget {
  target: { kind: 'clip'; clipId: string } | { kind: 'text'; overlayId: string }
  startUs: Micros
  durationUs: Micros
  keyframes: KeyframeTracks | undefined
}

interface DragState {
  fromAtUs: Micros
  atUs: Micros
  paths: string[]
}

export function TimelineKeyframeStrip({
  owner,
  pixelsPerSecond
}: {
  owner: KeyframeStripTarget
  pixelsPerSecond: number
}): JSX.Element | null {
  const t = useT()
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; marker: KeyframeMarker } | null>(null)

  const markers = keyframeMarkers(owner.keyframes)
  if (markers.length === 0) return null

  /** Mốc mới khi kéo, đã bắt dính và kẹp trong lòng clip. */
  const draggedAtUs = (event: PointerEvent<HTMLElement>, element: HTMLElement): Micros => {
    const lane = element.closest('.timeline-lane')
    const laneBox = lane?.getBoundingClientRect()
    const state = useEditorStore.getState()
    const document = state.session?.document
    if (!laneBox || !document) return 0

    const absoluteUs = pxToUs(event.clientX - laneBox.left, pixelsPerSecond)
    const context = {
      document,
      pixelsPerSecond,
      frameRate: document.settings.frameRate,
      // Đọc MỘT LẦN, không theo dõi: đầu phát không nhúc nhích trong một cú kéo,
      // còn theo dõi nó ở đây là kéo cả timeline vẽ lại mỗi khung khi đang phát.
      playheadUs: state.playheadUs,
      enabled: true
    }
    const snapped = snapTime(absoluteUs, collectSnapTargets(context), context).us
    // Kẹp trong lòng clip. Khác với mốc trôi ra ngoài do cắt mép — chỗ đó là hệ
    // quả phụ và được giữ lại — còn đây là thao tác CỐ Ý với chính mốc này, nên
    // thả nó ra ngoài chỗ nhìn thấy được là tạo một mốc không bao giờ chạy.
    return Math.min(owner.durationUs, Math.max(0, snapped - owner.startUs))
  }

  const commit = (state: DragState): void => {
    if (state.atUs === state.fromAtUs) return
    const commands: EditorCommand[] = state.paths.map((path) => ({
      type: 'keyframe/move',
      target: owner.target,
      path,
      fromAtUs: state.fromAtUs,
      toAtUs: state.atUs
    }))
    // Một cú kéo là MỘT bước hoàn tác, dù nó dời năm thuộc tính cùng lúc.
    useEditorStore.getState().run(commands, t.timeline.keyframeMove)
  }

  const applyEasing = (marker: KeyframeMarker, easing: KeyframeEasing): void => {
    const commands: EditorCommand[] = marker.paths.map((path) => ({
      type: 'keyframe/move',
      target: owner.target,
      path,
      fromAtUs: marker.atUs,
      toAtUs: marker.atUs,
      easing
    }))
    useEditorStore.getState().run(commands, t.timeline.keyframeEasing)
  }

  const removeMarker = (marker: KeyframeMarker): void => {
    const commands: EditorCommand[] = marker.paths.map((path) => ({
      type: 'keyframe/remove',
      target: owner.target,
      path,
      atUs: marker.atUs
    }))
    useEditorStore.getState().run(commands, t.timeline.keyframeRemove)
  }

  return (
    <>
      <div
        className="timeline-keyframes"
        style={{
          left: usToPx(owner.startUs, pixelsPerSecond),
          width: usToPx(owner.durationUs, pixelsPerSecond)
        }}
      >
        {markers.map((marker) => {
          const atUs = drag?.fromAtUs === marker.atUs ? drag.atUs : marker.atUs
          return (
            <span
              key={marker.atUs}
              className={`timeline-keyframe-dot${drag?.fromAtUs === marker.atUs ? ' timeline-keyframe-dot--dragging' : ''}`}
              style={{ left: usToPx(atUs, pixelsPerSecond) }}
              role="button"
              tabIndex={0}
              data-at-us={marker.atUs}
              data-paths={marker.paths.length}
              aria-label={t.timeline.keyframeDot}
              title={`${t.timeline.keyframeDot} · ${marker.paths.length}`}
              onPointerDown={(event) => {
                // Không để timeline hiểu nhầm là kéo clip hay tua đầu phát.
                event.stopPropagation()
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                setDrag({ fromAtUs: marker.atUs, atUs: marker.atUs, paths: marker.paths })
              }}
              onPointerMove={(event) => {
                if (drag?.fromAtUs !== marker.atUs) return
                // Chỉ state CỤC BỘ chạy theo chuột; tài liệu đổi đúng một lần
                // lúc thả, nếu không mỗi cú kéo nhồi hàng chục bước hoàn tác.
                setDrag({ ...drag, atUs: draggedAtUs(event, event.currentTarget) })
              }}
              onPointerUp={() => {
                if (drag?.fromAtUs !== marker.atUs) return
                commit(drag)
                setDrag(null)
              }}
              onPointerCancel={() => setDrag(null)}
              onDoubleClick={(event) => {
                event.stopPropagation()
                // Đưa đầu phát tới đúng mốc: đó là cách duy nhất chỉnh chính xác
                // giá trị tại một keyframe bằng thanh trượt ở panel Thuộc tính.
                useEditorStore.getState().setPlayhead(owner.startUs + marker.atUs)
              }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenu({ x: event.clientX, y: event.clientY, marker })
              }}
            />
          )
        })}
      </div>

      {menu && (
        <TimelineKeyframeMenu
          x={menu.x}
          y={menu.y}
          easing={menu.marker.easing}
          onPickEasing={(easing) => {
            applyEasing(menu.marker, easing)
            setMenu(null)
          }}
          onRemove={() => {
            removeMarker(menu.marker)
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
