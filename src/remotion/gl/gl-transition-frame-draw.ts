/**
 * Đọc pixel của một thẻ media và đặt nó vào canvas trung gian.
 *
 * Phái sinh từ `src/gl/GlTransition.tsx` của OpenChatCut (AGPL-3.0-or-later) —
 * xem `NOTICE`.
 *
 * Tách khỏi component vì đây là phần thuần DOM, không JSX: nó kiểm được bằng một
 * canvas dựng tay, còn component thì phải dựng cả cây Remotion mới chạy.
 */

export type MediaElement = HTMLVideoElement | HTMLImageElement

/** Thẻ media đã sẵn pixel để đọc chưa. */
export function isReady(element: MediaElement): boolean {
  return element instanceof HTMLVideoElement
    ? element.readyState >= 2 && !element.seeking
    : element.complete && element.naturalWidth > 0
}

function mediaSize(element: MediaElement): { width: number; height: number } {
  return element instanceof HTMLVideoElement
    ? { width: element.videoWidth, height: element.videoHeight }
    : { width: element.naturalWidth, height: element.naturalHeight }
}

/**
 * Vẽ thẻ media vào canvas trung gian theo lối `contain`, canh giữa.
 *
 * Phải khớp với cách lớp DOM đặt media (`objectFit: contain`), không thì ngay khi
 * chuyển cảnh bắt đầu, hình nhảy một cái vì khung ngắm đổi.
 */
export function drawContained(context: CanvasRenderingContext2D, element: MediaElement): void {
  const source = mediaSize(element)
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  if (!source.width || !source.height) return
  const scale = Math.min(context.canvas.width / source.width, context.canvas.height / source.height)
  const width = source.width * scale
  const height = source.height * scale
  context.drawImage(
    element,
    (context.canvas.width - width) / 2,
    (context.canvas.height - height) / 2,
    width,
    height
  )
}
