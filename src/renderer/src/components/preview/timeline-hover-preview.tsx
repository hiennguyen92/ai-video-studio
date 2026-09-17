import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { ProjectComposition } from '../../../../remotion/project-composition'
import type { ProjectDocument } from '../../../../shared/domain/project-document-types'
import { buildRenderPlan } from '../../../../shared/domain/remotion-render-plan'
import {
  formatTimecode,
  frameOfMicros,
  frameRateToNumber
} from '../../../../shared/domain/time-units'
import { useLocalMediaUrls } from '../../hooks/use-local-media-urls'
import { useEditorStore } from '../../state/editor-store'

/**
 * Khung xem trước nhỏ ở góc phải dưới preview, hiện khung hình tại VỊ TRÍ CHUỘT khi
 * rê trên timeline — preview lớn vẫn đứng ở đầu phát. Tìm cảnh bằng cách lướt chuột
 * mà không làm mất chỗ đầu phát đang đứng.
 *
 * Vẽ bằng đúng `ProjectComposition` như preview lớn, nên thấy cả chữ, effect, filter.
 *
 * Player chỉ được dựng ở LẦN RÊ ĐẦU TIÊN rồi giữ lại (ẩn đi khi chuột rời timeline):
 * dựng sẵn từ đầu là tải media hai lần cho người không bao giờ lướt; dựng lại mỗi
 * lần rê vào thì phải chờ tải lại video mỗi lần.
 *
 * Tua bằng cách ĐĂNG KÝ store chứ không theo dõi bằng hook, và gộp theo khung hình
 * trình duyệt: rê nhanh bắn hàng trăm sự kiện, chỉ khung mới nhất mới đáng tua.
 */
export function TimelineHoverPreview({
  document
}: {
  document: ProjectDocument
}): JSX.Element | null {
  const hovering = useEditorStore((state) => state.hoverUs !== null)
  const [mounted, setMounted] = useState(false)
  if (hovering && !mounted) setMounted(true)

  if (!mounted) return null
  return <HoverPlayer document={document} visible={hovering} />
}

function HoverPlayer({
  document,
  visible
}: {
  document: ProjectDocument
  visible: boolean
}): JSX.Element {
  const playerRef = useRef<PlayerRef>(null)
  const timecodeRef = useRef<HTMLSpanElement>(null)
  const mediaUrls = useLocalMediaUrls()
  const plan = useMemo(() => buildRenderPlan(document), [document])
  // Tắt dấu hiệu DOM: khung điều khiển kéo chữ và kiểm thử chỉ được thấy preview lớn.
  const inputProps = useMemo(() => ({ plan, mediaUrls, markers: false }), [plan, mediaUrls])
  const fps = document.settings.frameRate

  useEffect(() => {
    let raf = 0
    const seek = (hoverUs: number | null): void => {
      if (hoverUs === null) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const frame = Math.min(frameOfMicros(hoverUs, fps), Math.max(0, plan.durationInFrames - 1))
        playerRef.current?.seekTo(frame)
        // Ghi thẳng vào DOM: đổi state mỗi khung là vẽ lại cả Player.
        if (timecodeRef.current) timecodeRef.current.textContent = formatTimecode(hoverUs, fps)
      })
    }
    seek(useEditorStore.getState().hoverUs)
    const unsubscribe = useEditorStore.subscribe((state, previous) => {
      if (state.hoverUs !== previous.hoverUs) seek(state.hoverUs)
    })
    return () => {
      cancelAnimationFrame(raf)
      unsubscribe()
    }
  }, [fps, plan.durationInFrames])

  return (
    <div
      className={`preview__hover${visible ? ' preview__hover--visible' : ''}`}
      style={{ aspectRatio: `${plan.width} / ${plan.height}` }}
      aria-hidden={!visible}
      data-testid="timeline-hover-preview"
    >
      <Player
        ref={playerRef}
        component={ProjectComposition}
        inputProps={inputProps}
        durationInFrames={plan.durationInFrames}
        fps={frameRateToNumber(fps)}
        compositionWidth={plan.width}
        compositionHeight={plan.height}
        style={{ width: '100%', height: '100%' }}
        controls={false}
        clickToPlay={false}
        initiallyMuted
        acknowledgeRemotionLicense
      />
      <span ref={timecodeRef} className="preview__hover-timecode" />
    </div>
  )
}
