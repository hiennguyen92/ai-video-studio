import type { CSSProperties, JSX } from 'react'
import type { ResolvedTextFrame } from '../shared/domain/remotion-render-plan'
import {
  buildBubbleTailImageUri,
  buildDecorImageUri
} from '../shared/domain/text-frame-svg-builders'
import { frameBorderPx } from './text-overlay-frame-css'

/**
 * Khung nền dễ thương sau chữ.
 *
 * Nằm ở file riêng chứ không nhét vào `project-composition.tsx`: file đó đã gần
 * 600 dòng. Đây cũng là ranh giới rút lui — nếu `border-image` hỏng ở một bản
 * Chromium nào đó về sau, chỉ file này phải viết lại, còn mô hình dữ liệu, lệnh
 * và giao diện không hề biết khung được vẽ bằng gì.
 *
 * Không tra danh mục ở đây: khung đến nơi đã tra xong từ tầng dựng kế hoạch.
 */

/**
 * Đuôi bong bóng và điểm trang trí góc.
 *
 * Chúng KHÔNG đi qua `border-image` được: cơ chế đó lát mép, nên bất cứ thứ gì
 * cần nằm đúng một chỗ sẽ bị nhân lên thành cả hàng. Nên chúng là phần tử đặt
 * tuyệt đối, con của khối chữ.
 *
 * Kích thước tính theo BỀ DÀY VIỀN chứ không theo px cố định: chữ đổi cỡ thì viền
 * dày mỏng theo, và một cái đuôi đặt theo px sẽ trôi khỏi mép bong bóng.
 *
 * Đuôi được phép THÒ RA ngoài hộp viền, trang trí thì không. Nghe như mâu thuẫn
 * với luật cấm `border-image-outset`, nhưng khác nhau ở chỗ: `outset` đẩy CHÍNH
 * cái khung ra ngoài, còn đây là phần tử con đặt tuyệt đối. Cái giá của việc thò
 * ra chỉ là khung điều khiển kéo-thả hụt mất phần đuôi ở cạnh dưới — người dùng
 * vẫn nắm được thân bong bóng như thường. Giữ đuôi nằm gọn trong dải viền thì nó
 * teo lại thành một cái mấu, và một bong bóng thoại không có đuôi thì chỉ là cái
 * hộp bo góc.
 */
export function TextOverlayFrameParts({
  frame,
  fontSizePx
}: {
  frame: ResolvedTextFrame
  fontSizePx: number
}): JSX.Element | null {
  const border = frameBorderPx(frame, fontSizePx)
  const tail = frame.style.hasTail ? buildBubbleTailImageUri(frame.palette) : undefined
  const decor = frame.decor ? buildDecorImageUri(frame.decor, frame.palette) : undefined
  if (!tail && !decor) return null

  const chung: CSSProperties = {
    position: 'absolute',
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'contain',
    pointerEvents: 'none'
  }

  return (
    <>
      {tail && (
        <div
          aria-hidden
          style={{
            ...chung,
            // Mép trên của đuôi ăn ngược vào thân bong bóng để hai hình dính
            // nhau, không hở khe ở chỗ nối.
            // Mép TRÊN của đuôi phải ăn vào trong nét bong bóng, mà nét đó nằm
            // ở khoảng 0,6 bề dày viền tính từ mép ngoài. Đặt hụt ra là hở một
            // khe giữa đuôi và thân.
            left: '14%',
            bottom: -border * 1.8,
            width: border * 0.93,
            height: border * 1.3,
            backgroundImage: tail
          }}
        />
      )}
      {decor && (
        <div
          aria-hidden
          style={{
            ...chung,
            // Nằm HẲN trên khung ở góc trên-phải, chỉ ló một phần lên dải viền.
            // Đặt lệch ra ngoài thì nửa trên rơi vào nền và nhìn như bị cắt —
            // mép khung không phải đường thẳng nên không có chỗ nào để nó tựa.
            top: -border * 0.4,
            right: -border * 0.05,
            width: border * 0.8,
            height: border * 0.8,
            backgroundImage: decor
          }}
        />
      )}
    </>
  )
}
