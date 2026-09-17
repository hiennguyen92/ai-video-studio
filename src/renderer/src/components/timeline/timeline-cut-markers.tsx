import {
  useCallback,
  useMemo,
  useState,
  type JSX,
  type KeyboardEvent,
  type MouseEvent
} from 'react'
import {
  cutTransitionDurationUs,
  findCutPoints,
  isJunction,
  removeCutTransitionCommands,
  setCutTransitionDurationCommands,
  type CutPoint
} from '../../../../shared/domain/timeline-cut-transitions'
import type { Track } from '../../../../shared/domain/timeline-track-types'
import { useEditorStore } from '../../state/editor-store'
import { interpolate, useT } from '../../i18n/use-translation'
import { TRANSITION_LABEL_KEYS } from '../library/clip-effect-labels'
import { usToPx } from './timeline-geometry'
import { TimelineCutContextMenu } from './timeline-cut-context-menu'

/**
 * Biểu tượng chuyển cảnh ở chỗ nối giữa hai clip.
 *
 * Chuyển cảnh không còn chỉnh ở Inspector của từng clip; chỗ duy nhất để thấy nó
 * đang dùng kiểu gì là đây. Chuột phải (hoặc phím Menu / Shift+F10 khi biểu tượng
 * đang focus) mở menu chọn thời lượng và xoá — không đặt nút xoá thường trực trên
 * timeline, vì một nút nhỏ nằm ngay chỗ hay bấm để chọn clip là dễ bấm nhầm.
 *
 * Chỗ nối CHƯA có chuyển cảnh thì không vẽ gì, trừ lúc đang rê thẻ chuyển cảnh
 * trúng nó — khi đó hiện vạch báo "thả vào đây".
 */
export function TimelineCutMarkers({
  track,
  pixelsPerSecond,
  hoverAtUs
}: {
  track: Track
  pixelsPerSecond: number
  /** Mốc chỗ nối đang được rê trúng trên lane này, nếu có. */
  hoverAtUs: number | null
}): JSX.Element {
  const t = useT()
  const run = useEditorStore((state) => state.run)
  const points = useMemo(() => findCutPoints(track), [track])
  const [menu, setMenu] = useState<{ atUs: number; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const openMenu = (point: CutPoint, x: number, y: number): void => {
    if (track.locked) return
    setMenu({ atUs: point.atUs, x, y })
  }

  // Menu đọc chỗ nối MỚI NHẤT theo mốc thời gian: giữ nguyên object cũ thì chọn
  // thời lượng lần hai sẽ tính trên dữ liệu trước lần một.
  const menuPoint = menu ? points.find((point) => point.atUs === menu.atUs && point.kind) : null

  return (
    <>
      {points.map((point) => {
        const dropHere = hoverAtUs === point.atUs && isJunction(point)
        if (!point.kind && !dropHere) return null

        const name = point.kind ? t.inspector[TRANSITION_LABEL_KEYS[point.kind]] : ''
        const label = interpolate(t.timeline.cutTransition, { name })
        return (
          <div
            key={`${point.atUs}-${point.leftClip?.id ?? ''}-${point.rightClip?.id ?? ''}`}
            className={`timeline-cut ${dropHere ? 'timeline-cut--drop' : ''}`}
            style={{ left: usToPx(point.atUs, pixelsPerSecond) }}
            // Bấm vào biểu tượng không được kéo theo clip nằm bên dưới.
            onPointerDown={(event) => event.stopPropagation()}
          >
            {point.kind && (
              <button
                type="button"
                className="timeline-cut__badge"
                aria-label={label}
                aria-haspopup="menu"
                title={`${label} — ${t.timeline.cutTransitionMenuHint}`}
                onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                  event.preventDefault()
                  openMenu(point, event.clientX, event.clientY)
                }}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
                    return
                  }
                  event.preventDefault()
                  const box = event.currentTarget.getBoundingClientRect()
                  openMenu(point, box.right, box.bottom)
                }}
              >
                ⇄
              </button>
            )}
          </div>
        )
      })}

      {menu && menuPoint && (
        <TimelineCutContextMenu
          x={menu.x}
          y={menu.y}
          title={t.inspector[TRANSITION_LABEL_KEYS[menuPoint.kind!]]}
          currentDurationUs={cutTransitionDurationUs(menuPoint)}
          onPickDuration={(durationUs) =>
            run(
              setCutTransitionDurationCommands(menuPoint, durationUs),
              t.timeline.cutTransitionDuration
            )
          }
          onRemove={() =>
            run(removeCutTransitionCommands(menuPoint), t.timeline.removeCutTransitionShort)
          }
          onClose={closeMenu}
        />
      )}
    </>
  )
}
