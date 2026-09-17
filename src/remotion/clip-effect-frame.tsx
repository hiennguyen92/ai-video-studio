import type { CSSProperties, JSX, ReactNode } from 'react'
import { buildClipEffectsRender } from '../shared/domain/clip-effect-render'
import type { ClipEffect } from '../shared/domain/clip-effect-types'

/**
 * Khung bao vẽ chồng effect quanh media của một clip.
 *
 * Không đọc khung hình từ Remotion mà nhận qua props, để thẻ minh hoạ trong tab
 * Effects (ngoài Player) dùng lại đúng component này — thẻ hiện đúng thứ bản xuất
 * sẽ ra.
 *
 * Cấu trúc DOM giữ NGUYÊN dù có effect hay không: thêm/gỡ effect mà đổi cây DOM
 * thì thẻ video bị gắn lại, preview nháy đen và tải lại video. Vì vậy mặt nạ là
 * `<clipPath>` SVG nối chuỗi (một `clip-path: url()` duy nhất), không phải các lớp
 * `div` bọc lồng nhau theo số mặt nạ.
 *
 * Bộ lọc effect đặt lên lớp bọc media, không đặt lên chính thẻ media: thẻ media đã
 * mang chỉnh màu + look, đặt chung một `filter` thì phải nối chuỗi, còn tách lớp
 * thì thứ tự "chỉnh màu → look → effect" tự đúng.
 */
export function ClipEffectFrame({
  clipKey,
  effects,
  frame,
  fps,
  width,
  height,
  children
}: {
  clipKey: string
  effects: readonly ClipEffect[] | undefined
  frame: number
  fps: number
  /** Kích thước hộp media (px CSS) — bộ lọc tính toạ độ theo hộp này. */
  width: number
  height: number
  children: ReactNode
}): JSX.Element {
  const render = buildClipEffectsRender(clipKey, effects, { frame, fps, width, height })

  return (
    <div
      style={{
        position: 'relative',
        flex: 'none',
        width,
        height,
        transform: render.transform
      }}
    >
      {/* Lớp phủ (tối góc, sọc quét) nằm NGOÀI bộ lọc để giữ đúng màu của nó; mặt nạ bọc cả hai. */}
      <div
        style={{ ...FILL, clipPath: render.clipPathId ? `url(#${render.clipPathId})` : undefined }}
      >
        <div
          style={{
            ...FILL,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            filter: render.filterId ? `url(#${render.filterId})` : undefined
          }}
        >
          {children}
        </div>
        {render.overlays.map((overlay, index) => (
          <div
            key={index}
            style={{
              ...FILL,
              background: overlay.background,
              mixBlendMode: overlay.mixBlendMode,
              opacity: overlay.opacity,
              pointerEvents: 'none'
            }}
          />
        ))}
      </div>
      {render.defsSvg && (
        <svg
          aria-hidden
          width={0}
          height={0}
          style={{ position: 'absolute' }}
          dangerouslySetInnerHTML={{ __html: `<defs>${render.defsSvg}</defs>` }}
        />
      )}
    </div>
  )
}

const FILL: CSSProperties = { position: 'absolute', inset: 0 }
