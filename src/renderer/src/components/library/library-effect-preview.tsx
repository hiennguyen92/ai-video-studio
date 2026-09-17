import { useEffect, useRef, useState, type JSX } from 'react'
import { ClipEffectFrame } from '../../../../remotion/clip-effect-frame'
import {
  defaultEffectParams,
  type EffectDefinition
} from '../../../../shared/domain/clip-effect-types'
import { DEFAULT_EFFECT_INTENSITY } from '../../../../shared/domain/clip-effect-commands'

const PREVIEW_FPS = 30

/**
 * Ảnh minh hoạ một effect: cảnh vẽ sẵn của Library, bọc bằng CHÍNH component vẽ
 * effect của composition — thẻ hiện đúng thứ bản xuất sẽ ra.
 *
 * Bộ lọc tính theo px nên phải biết cỡ thật của ô (đo bằng ResizeObserver). Effect
 * động (hạt, glitch, rung tay…) chỉ chạy khi rê chuột vào thẻ: 29 bộ lọc SVG đổi
 * mỗi khung cùng lúc thì cả panel ì hẳn.
 */
export function LibraryEffectPreview({
  definition,
  animate
}: {
  definition: EffectDefinition
  animate: boolean
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [frame, setFrame] = useState(12)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((previous) =>
        previous.width === Math.round(width) && previous.height === Math.round(height)
          ? previous
          : { width: Math.round(width), height: Math.round(height) }
      )
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!animate) return
    let handle = 0
    const started = performance.now()
    const tick = (now: number): void => {
      setFrame(12 + Math.floor(((now - started) / 1000) * PREVIEW_FPS))
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [animate])

  const effects = [
    {
      id: 'preview',
      kind: definition.kind,
      intensity: DEFAULT_EFFECT_INTENSITY + 0.2,
      params: defaultEffectParams(definition)
    }
  ]

  return (
    <span ref={ref} className="library-preview library-preview--checker" aria-hidden>
      {size.width > 0 && (
        <ClipEffectFrame
          clipKey={`library-${definition.kind}`}
          effects={effects}
          frame={frame}
          fps={PREVIEW_FPS}
          width={size.width}
          height={size.height}
        >
          <span className="library-preview__scene library-preview__scene--a">
            {/* Mảng xanh lá và mảng tối để thẻ tách nền có thứ mà tách. */}
            {definition.group === 'key' && <span className="library-preview__key-patches" />}
          </span>
        </ClipEffectFrame>
      )}
    </span>
  )
}
