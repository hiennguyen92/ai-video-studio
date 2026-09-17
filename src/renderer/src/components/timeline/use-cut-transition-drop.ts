import { useState, type DragEvent } from 'react'
import {
  LIBRARY_TRANSITION_DRAG_MIME,
  acceptsLibraryItem,
  parseLibraryDragPayload
} from '../../../../shared/domain/library-clip-effects'
import {
  findCutPoints,
  nearestJunction,
  setCutTransitionCommands,
  type CutPoint
} from '../../../../shared/domain/timeline-cut-transitions'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import { useEditorStore } from '../../state/editor-store'

/** Thả cách chỗ nối không quá chừng này (px trên màn hình) thì vẫn tính là trúng. */
const JUNCTION_HIT_PX = 28

/**
 * Thả thẻ chuyển cảnh từ tab Library vào CHỖ NỐI giữa hai clip trên một lane.
 *
 * Nghe ở lane chứ không ở clip: chỗ nối nằm đúng mép giữa hai clip, và con trỏ
 * có thể ở bên clip trước hay clip sau đều phải trúng. Trong lúc rê, chỗ nối gần
 * con trỏ nhất được tô sáng; không có chỗ nối nào đủ gần thì không nhận thả.
 */
export function useCutTransitionDrop(options: {
  pixelsPerSecond: number
  clientXToUs(clientX: number): number
}): {
  /** Chỗ nối đang được rê trúng, để tô sáng. */
  hover: { trackId: string; atUs: number } | null
  laneCutDropProps(track: Track): {
    onDragOver(event: DragEvent<HTMLDivElement>): void
    onDragLeave(event: DragEvent<HTMLDivElement>): void
    onDrop(event: DragEvent<HTMLDivElement>): void
  }
} {
  const { pixelsPerSecond, clientXToUs } = options
  const run = useEditorStore((state) => state.run)
  const [hover, setHover] = useState<{ trackId: string; atUs: number } | null>(null)

  const junctionAt = (event: DragEvent<HTMLDivElement>, track: Track): CutPoint | null => {
    const maxDistanceUs = (JUNCTION_HIT_PX / Math.max(pixelsPerSecond, 1)) * 1_000_000
    return nearestJunction(findCutPoints(track), clientXToUs(event.clientX), maxDistanceUs)
  }

  const accepts = (event: DragEvent<HTMLDivElement>, track: Track): boolean =>
    acceptsLibraryItem(track.kind) &&
    !track.locked &&
    event.dataTransfer.types.includes(LIBRARY_TRANSITION_DRAG_MIME)

  return {
    hover,
    laneCutDropProps: (track) => ({
      onDragOver: (event) => {
        if (!accepts(event, track)) return
        const junction = junctionAt(event, track)
        if (!junction) {
          setHover((current) => (current?.trackId === track.id ? null : current))
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setHover((current) =>
          current?.trackId === track.id && current.atUs === junction.atUs
            ? current
            : { trackId: track.id, atUs: junction.atUs }
        )
      },
      onDragLeave: (event) => {
        // Rời sang phần tử con (clip) của chính lane cũng bắn dragleave; chỉ xoá
        // tô sáng khi con trỏ thật sự ra khỏi lane.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
        setHover((current) => (current?.trackId === track.id ? null : current))
      },
      onDrop: (event) => {
        if (!accepts(event, track)) return
        event.preventDefault()
        setHover(null)
        const junction = junctionAt(event, track)
        const item = parseLibraryDragPayload(
          event.dataTransfer.getData(LIBRARY_TRANSITION_DRAG_MIME)
        )
        if (!junction || item?.type !== 'transition') return
        run(setCutTransitionCommands(junction, item.kind), 'Đặt transition')
      }
    })
  }
}
