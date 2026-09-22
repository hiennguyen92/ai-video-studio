import { useLayoutEffect, useRef, type JSX } from 'react'
import {
  libraryCardFrameAt,
  libraryCardRestingFrame,
  type LibraryCardFrame
} from '../../../../shared/domain/library-card-preview'
import type { ClipMotionKind } from '../../../../shared/domain/clip-motion-types'
import type { LibraryClipItem } from '../../../../shared/domain/library-clip-effects'

/**
 * Ký hiệu hướng ở góc thẻ Zoom.
 *
 * Chuyển động thật rất nhẹ (phóng tối đa 16%, lia 5%) nên trên thẻ nhỏ các thẻ
 * trông gần như nhau khi đứng yên. Không phóng đại chuyển động — thẻ sẽ hứa thứ
 * video không làm — mà thêm ký hiệu để phân biệt ngay, còn rê chuột thì xem thật.
 */
const MOTION_GLYPHS: Record<ClipMotionKind, string> = {
  'zoom-in': '＋',
  'zoom-out': '－',
  'pan-left': '←',
  'pan-right': '→',
  'pan-up': '↑',
  'pan-down': '↓',
  'punch-in': '⚡',
  shake: '≈'
}

/**
 * Hình minh hoạ chuyển động trên một thẻ Library.
 *
 * Chuyển cảnh: cảnh A đứng yên, cảnh B hiện ra đè lên bằng đúng kiểu chuyển cảnh.
 * Zoom: một cảnh chạy đúng chuyển động. Khung hình tính bằng CÙNG hàm với bản xuất
 * (xem `libraryCardFrameAt`).
 *
 * Chỉ chạy khi `playing` (rê chuột hoặc focus vào thẻ); còn lại đứng yên ở giữa
 * hiệu ứng. Cả lưới cùng chạy liên tục là hàng chục vòng vẽ mỗi giây ngay cạnh
 * Player — đúng kiểu tải đã từng làm preview tụt khung.
 *
 * Ghi style THẲNG vào DOM trong vòng `requestAnimationFrame`, không qua state:
 * đổi state 60 lần mỗi giây là dựng lại React 60 lần chỉ để dời một ô màu.
 */
export function LibraryCardPreview({
  item,
  playing
}: {
  item: LibraryClipItem
  playing: boolean
}): JSX.Element {
  const incomingRef = useRef<HTMLSpanElement>(null)
  const outgoingRef = useRef<HTMLSpanElement>(null)
  const overlayRef = useRef<HTMLSpanElement>(null)
  const motionRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const paint = (
      element: HTMLSpanElement,
      style: NonNullable<LibraryCardFrame['incoming']>
    ): void => {
      element.style.opacity = String(style.opacity)
      element.style.transform = style.transform ?? ''
      element.style.clipPath = style.clipPath ?? ''
      element.style.filter = style.filter ?? ''
      // Mặt nạ và vệt sáng cũng phải có trên thẻ: thiếu chúng thì thẻ của kiểu
      // dùng mặt nạ đứng im, và lời hứa "thẻ là thứ sẽ ra video" thành nói suông.
      element.style.maskImage = style.maskImage ?? ''
      element.style.webkitMaskImage = style.maskImage ?? ''
    }

    const apply = (frame: LibraryCardFrame): void => {
      const outgoing = outgoingRef.current
      if (outgoing && frame.outgoing) paint(outgoing, frame.outgoing)
      const incoming = incomingRef.current
      if (incoming && frame.incoming) {
        paint(incoming, frame.incoming)
      }
      const overlay = overlayRef.current
      if (overlay && frame.incoming) {
        overlay.style.background = frame.incoming.overlay ?? ''
        overlay.style.clipPath = frame.incoming.clipPath ?? ''
        overlay.style.maskImage = frame.incoming.maskImage ?? ''
        overlay.style.webkitMaskImage = frame.incoming.maskImage ?? ''
      }
      const scene = motionRef.current
      if (scene && frame.motionTransform !== undefined) {
        scene.style.transform = frame.motionTransform
      }
    }

    const itemNow: LibraryClipItem =
      item.type === 'transition'
        ? { type: 'transition', kind: item.kind }
        : { type: 'motion', kind: item.kind }
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (!playing || reduceMotion) {
      apply(libraryCardRestingFrame(itemNow))
      return
    }

    const startedAt = performance.now()
    let handle = 0
    const tick = (now: number): void => {
      apply(libraryCardFrameAt(itemNow, now - startedAt))
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(handle)
      apply(libraryCardRestingFrame(itemNow))
    }
  }, [item.type, item.kind, playing])

  return (
    <span className="library-preview" aria-hidden>
      {item.type === 'transition' ? (
        <>
          <span ref={outgoingRef} className="library-preview__scene library-preview__scene--a" />
          <span ref={incomingRef} className="library-preview__scene library-preview__scene--b" />
          <span ref={overlayRef} className="library-preview__overlay" aria-hidden />
        </>
      ) : (
        <>
          <span ref={motionRef} className="library-preview__scene library-preview__scene--a" />
          <span className="library-preview__glyph">{MOTION_GLYPHS[item.kind]}</span>
        </>
      )}
    </span>
  )
}
