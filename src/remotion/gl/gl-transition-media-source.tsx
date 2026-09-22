import { Img, Video } from 'remotion'
import type { JSX, MutableRefObject } from 'react'
import type { GlTransitionSource } from '../../shared/domain/gl-transition-plan'
import type { MediaElement } from './gl-transition-frame-draw'

/**
 * Nguồn pixel cho lớp chuyển cảnh WebGL: một thẻ media ẩn, cộng phép vẽ nó vào
 * canvas trung gian.
 *
 * Phái sinh từ `src/gl/GlTransition.tsx` của OpenChatCut (AGPL-3.0-or-later) —
 * xem `NOTICE`.
 *
 * Tách khỏi lớp vẽ vì đây là phần nói chuyện với DOM và với Remotion, còn bên kia
 * là phần nói chuyện với GL. Hai thứ hỏng theo hai kiểu khác nhau.
 */

export function MediaSource({
  source,
  url,
  elementRef
}: {
  source: GlTransitionSource
  url: string
  elementRef: MutableRefObject<MediaElement | null>
}): JSX.Element {
  const style = { width: '100%', height: '100%', objectFit: 'contain' as const }
  // `crossOrigin` là bắt buộc, không phải tuỳ chọn: thiếu nó thì canvas trung gian
  // bị coi là "nhiễm" và `texImage2D` ném lỗi bảo mật. Server media nằm ở cổng
  // khác trang dựng hình, nên đây luôn là yêu cầu chéo nguồn.
  if (source.media === 'image') {
    return (
      <Img
        ref={elementRef as MutableRefObject<HTMLImageElement | null>}
        src={url}
        crossOrigin="anonymous"
        style={style}
      />
    )
  }
  // Câm: tiếng đã do Sequence của chính clip phát. Thẻ này chỉ để lấy pixel.
  //
  // `<Video>` chứ không phải `<OffthreadVideo>`: chỉ `<Video>` mới cho cầm ref tới
  // thẻ thật để đọc pixel, còn `<OffthreadVideo>` lúc xuất là một thẻ ảnh do
  // Remotion thay vào và không hứa gì về ref.
  return (
    <Video
      ref={elementRef as MutableRefObject<HTMLVideoElement | null>}
      src={url}
      startFrom={source.sourceFromFrame}
      playbackRate={source.playbackRate}
      crossOrigin="anonymous"
      muted
      style={style}
    />
  )
}
