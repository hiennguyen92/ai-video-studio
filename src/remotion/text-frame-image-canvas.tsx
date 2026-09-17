import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { continueRender, delayRender } from 'remotion'
import { layoutNineSlice, type NineSliceRepeat } from '../shared/domain/nine-slice-layout'
import { textFramePngUrl } from './text-frame-png-urls'

/**
 * Khung ảnh vẽ lên MỘT canvas phủ kín hộp viền của khối chữ.
 *
 * Thay cho `border-image`: chín mảnh rời của CSS để lại vệt kẻ ở mép mảnh khi
 * khối rơi vào toạ độ lẻ. Ở đây mọi mảnh đặt vào pixel nguyên (xem
 * `layoutNineSlice`), và canvas là một bitmap liền — thu nhỏ trên xem trước chỉ là
 * co một ảnh, không sinh thêm mối nối nào.
 *
 * Nằm dưới chữ nhờ `z-index: -1` trong ngữ cảnh xếp lớp mà `frameBoxCss` tạo ra.
 */

/** Ảnh đã giải mã xong, dùng chung giữa mọi khối chữ cùng khung. */
const decodedImages = new Map<string, HTMLImageElement>()
/** Ảnh đang giải mã, để hai khối chữ cùng khung không tải hai lần. */
const pendingImages = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = pendingImages.get(url)
  if (!pending) {
    const image = new Image()
    image.src = url
    pending = image.decode().then(() => {
      decodedImages.set(url, image)
      return image
    })
    // Hỏng thì bỏ khỏi hàng chờ, để lần sau còn thử lại thay vì hỏng mãi.
    pending.catch(() => pendingImages.delete(url))
    pendingImages.set(url, pending)
  }
  return pending
}

/**
 * Ảnh khung đã sẵn sàng để vẽ.
 *
 * Giữ bản dựng lại (`delayRender`) tới khi ảnh giải mã xong: bản xuất chụp từng
 * khung hình ngay khi React dựng xong, không chờ ảnh — thiếu bước này thì vài
 * khung đầu của chữ ra trần, rồi khung mới bật lên.
 *
 * `delayRender` gọi NGAY LÚC DỰNG (trong bộ khởi tạo `useState`), không chờ tới
 * `useEffect`: effect chạy sau khi vẽ, và Remotion có thể đã kiểm "hết việc chờ"
 * rồi chụp trước khi kịp giữ lại. Nơi dùng gắn `key` theo khung, nên đổi khung là
 * dựng mới và bộ khởi tạo chạy lại.
 */
function useDecodedImage(url: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(() =>
    url ? (decodedImages.get(url) ?? null) : null
  )
  const [handle] = useState(() =>
    url && !decodedImages.has(url) ? delayRender(`Nạp ảnh khung ${url}`) : null
  )

  useEffect(() => {
    if (!url || handle === null) return
    let cancelled = false
    loadImage(url)
      .then((loaded) => {
        if (!cancelled) setImage(loaded)
      })
      // Ảnh hỏng thì chữ ra không khung, không làm chết bản xuất.
      .catch(() => undefined)
      .finally(() => continueRender(handle))
    return () => {
      cancelled = true
    }
  }, [url, handle])

  return image
}

export function TextFrameImageCanvas({
  styleId,
  slicePx,
  repeat,
  borderPx
}: {
  styleId: string
  slicePx: number
  repeat: NineSliceRepeat
  /** Bề dày viền của khối chữ, cũng là bề rộng góc trên canvas. */
  borderPx: number
}): JSX.Element | null {
  const url = textFramePngUrl(styleId)
  const image = useDecodedImage(url)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const box = canvas?.parentElement
    if (!canvas || !box || !image) return

    const draw = (): void => {
      // Kích thước BỐ CỤC, không phải kích thước trên màn hình: phép thu nhỏ của
      // xem trước không ảnh hưởng, nên canvas có đúng độ phân giải của bản xuất.
      const width = box.offsetWidth
      const height = box.offsetHeight
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height

      const context = canvas.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, width, height)
      context.imageSmoothingQuality = 'high'
      for (const piece of layoutNineSlice({
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        slicePx,
        canvasWidth: width,
        canvasHeight: height,
        borderPx,
        repeat
      })) {
        context.drawImage(
          image,
          piece.sx,
          piece.sy,
          piece.sw,
          piece.sh,
          piece.dx,
          piece.dy,
          piece.dw,
          piece.dh
        )
      }
    }

    draw()
    // Khối đổi cỡ mà React không dựng lại — phông vừa tải xong làm chữ rộng ra —
    // thì vẫn phải vẽ lại, nếu không khung đứng yên ở kích thước cũ.
    const observer = new ResizeObserver(draw)
    observer.observe(box)
    return () => observer.disconnect()
  }, [image, slicePx, borderPx, repeat])

  if (!url) return null
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute',
        // Phần tử đặt tuyệt đối tính từ HỘP ĐỆM; lùi ra một bề dày viền để phủ kín
        // cả dải viền.
        top: -borderPx,
        left: -borderPx,
        width: `calc(100% + ${2 * borderPx}px)`,
        height: `calc(100% + ${2 * borderPx}px)`,
        zIndex: -1,
        pointerEvents: 'none'
      }}
    />
  )
}
