import { useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  getRemotionEnvironment,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { RenderPlanGlTransition } from '../../shared/domain/gl-transition-plan'
import { MediaSource } from './gl-transition-media-source'
import { drawContained, isReady, type MediaElement } from './gl-transition-frame-draw'
import { enterProgressAt } from '../../shared/domain/clip-transition-progress'
import { GL_TRANSITION_SHADERS } from './gl-transition-shaders'
import { createGlTransitionRuntime, type GlTransitionRuntime } from './gl-transition-runtime'

/**
 * Lớp vẽ của một chỗ nối chạy bằng WebGL.
 *
 * Phái sinh từ `src/gl/GlTransition.tsx` của OpenChatCut (AGPL-3.0-or-later) —
 * xem `NOTICE`.
 *
 * Cách ghép vào Remotion: hai thẻ media ẩn (độ mờ 0) chỉ để CÓ pixel; mỗi khung,
 * vẽ chúng vào hai canvas trung gian rồi đưa lên GL. Thẻ media ẩn chứ không phải
 * canvas riêng vì Remotion tự lo phần khó nhất — tua đúng khung nguồn và chờ tải.
 *
 * Lớp này nằm ĐÈ lên hai clip. Hai clip bên dưới vẫn chạy bản lùi CSS, nên khi
 * WebGL không dùng được — máy không có WebGL2, mất context, shader không biên dịch
 * nổi — canvas ẩn đi và người xem thấy bản lùi thay vì thấy một chỗ hổng.
 */

/**
 * Chờ tối đa chừng này mili giây cho hai nguồn sẵn sàng, rồi bỏ cuộc.
 *
 * `delayRender` của Remotion tự bỏ cuộc sau 30 giây và làm HỎNG cả bản xuất. Một
 * chuyển cảnh không vẽ được thì thà lùi về CSS còn hơn giết cả file: người dùng
 * mất một cú lật trang, không mất hai tiếng dựng phim.
 */
const READY_DEADLINE_MS = 5_000

export function GlTransitionLayer({
  transition,
  mediaUrls,
  frameSize
}: {
  transition: RenderPlanGlTransition
  mediaUrls: Record<string, string>
  frameSize: { width: number; height: number }
}): JSX.Element | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const runtimeRef = useRef<GlTransitionRuntime | null>(null)
  const outgoingRef = useRef<MediaElement | null>(null)
  const incomingRef = useRef<MediaElement | null>(null)
  // Hỏng một lần thì thôi hẳn: thử lại mỗi khung chỉ tổ ghi đầy log và làm bản
  // xuất chậm đi vì mỗi lần đều chờ hết hạn.
  const brokenRef = useRef(false)
  const [drawn, setDrawn] = useState(false)

  const shader = GL_TRANSITION_SHADERS[transition.kind]
  const outgoingUrl = mediaUrls[transition.outgoing.assetId]
  const incomingUrl = mediaUrls[transition.incoming.assetId]

  // Canvas trung gian: pixel của thẻ media, đã đặt đúng khung ngắm, thành nguồn
  // texture. Dựng một lần theo cỡ khung, không dựng lại mỗi khung hình.
  const staging = useMemo(() => {
    const make = (): HTMLCanvasElement => {
      const canvas = document.createElement('canvas')
      canvas.width = frameSize.width
      canvas.height = frameSize.height
      return canvas
    }
    return { outgoing: make(), incoming: make() }
  }, [frameSize.width, frameSize.height])

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !shader || brokenRef.current) return
    // Chỉ chặn lúc XUẤT. Trên bản xem trước, chặn là đứng hình cả trình phát; ở đó
    // thà bỏ một khung còn hơn.
    const blocking = getRemotionEnvironment().isRendering
    const handle = blocking
      ? delayRender(`chuyển cảnh WebGL ${transition.kind} khung ${frame}`)
      : null
    let released = false
    let raf = 0
    const startedAt = performance.now()

    const release = (): void => {
      if (released || handle === null) return
      released = true
      continueRender(handle)
    }
    const hide = (): void => {
      canvas.style.opacity = '0'
      setDrawn(false)
    }

    const tick = (): void => {
      const outgoing = outgoingRef.current
      const incoming = incomingRef.current
      if (!outgoing || !incoming || !isReady(outgoing) || !isReady(incoming)) {
        hide()
        if (performance.now() - startedAt > READY_DEADLINE_MS) {
          console.warn('[chuyển cảnh WebGL] hết hạn chờ nguồn, lùi về bản CSS', transition.kind)
          release()
          return
        }
        raf = requestAnimationFrame(tick)
        return
      }
      try {
        const runtime =
          runtimeRef.current ?? (runtimeRef.current = createGlTransitionRuntime(canvas))
        const outgoingContext = staging.outgoing.getContext('2d')
        const incomingContext = staging.incoming.getContext('2d')
        if (!outgoingContext || !incomingContext) throw new Error('không mở được context 2d')
        drawContained(outgoingContext, outgoing)
        drawContained(incomingContext, incoming)
        runtime.render(
          shader.frag,
          staging.outgoing,
          staging.incoming,
          // CÙNG hàm tiến độ với bản lùi CSS, nếu không thì lúc lớp này ẩn đi
          // hiện lại, chuyển cảnh nhảy một nấc.
          enterProgressAt(frame, transition.durationInFrames),
          shader.uniforms({ time: frame / fps, aspect: frameSize.width / frameSize.height })
        )
        canvas.style.opacity = '1'
        setDrawn(true)
      } catch (error) {
        brokenRef.current = true
        runtimeRef.current?.dispose()
        runtimeRef.current = null
        hide()
        console.error('[chuyển cảnh WebGL]', error)
      }
      release()
    }

    tick()
    return () => {
      cancelAnimationFrame(raf)
      release()
    }
  }, [frame, fps, frameSize.height, frameSize.width, shader, staging, transition])

  useLayoutEffect(() => {
    return () => {
      runtimeRef.current?.dispose()
      runtimeRef.current = null
    }
  }, [])

  if (!shader || !outgoingUrl || !incomingUrl) return null

  return (
    <AbsoluteFill>
      <AbsoluteFill aria-hidden style={{ opacity: 0, pointerEvents: 'none' }}>
        <AbsoluteFill>
          <MediaSource source={transition.outgoing} url={outgoingUrl} elementRef={outgoingRef} />
        </AbsoluteFill>
        <AbsoluteFill>
          <MediaSource source={transition.incoming} url={incomingUrl} elementRef={incomingRef} />
        </AbsoluteFill>
      </AbsoluteFill>
      <canvas
        ref={canvasRef}
        width={frameSize.width}
        height={frameSize.height}
        data-gl-transition={transition.key}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: drawn ? 1 : 0,
          pointerEvents: 'none'
        }}
      />
    </AbsoluteFill>
  )
}
