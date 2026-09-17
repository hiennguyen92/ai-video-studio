import { createContext, useContext } from 'react'

/**
 * Có gắn "dấu hiệu" DOM lên các lớp vẽ hay không: `data-clip-id`, `data-block-id`,
 * class `subtitle-cue` / `text-overlay` / `text-block`.
 *
 * Khung điều khiển kéo chữ trên preview dùng các dấu hiệu này để đo đúng khối, và kiểm
 * thử bám vào chúng. Khi có một Player THỨ HAI trên cùng trang (khung xem trước nhỏ
 * lúc lướt chuột), nó phải tắt dấu hiệu — không thì mọi truy vấn trúng hai phần tử và
 * khung điều khiển có thể bám nhầm vào bản thu nhỏ.
 */
export const CompositionMarkersContext = createContext(true)

export function useCompositionMarkers(): boolean {
  return useContext(CompositionMarkersContext)
}
