import { useMemo, type JSX } from 'react'
import type { MediaAsset } from '../../../../shared/domain/media-asset-types'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { mediaFileUrl } from '../../../../shared/ipc/ipc-contract'
import { filmstripCells } from './filmstrip-cells'

/** Số khung mặc định của sprite, khớp với `generateFilmstrip` ở tiến trình main. */
const DEFAULT_FRAME_COUNT = 40

/**
 * Dải hình nền của clip video.
 *
 * Mỗi khung là một ô riêng, đặt ảnh sprite ở đúng khung của nó và để trình duyệt
 * tự suy chiều cao từ tỉ lệ thật của ảnh (`background-size: … auto`). Nhờ thế
 * ảnh chỉ bị cắt bớt trên/dưới chứ KHÔNG bị kéo méo, dù zoom hay chiều cao track
 * có đổi thế nào.
 */
export function TimelineClipFilmstrip({
  asset,
  clip,
  widthPx,
  pixelsPerSecond,
  trackHeightPx
}: {
  asset: MediaAsset
  clip: Clip
  widthPx: number
  pixelsPerSecond: number
  trackHeightPx: number
}): JSX.Element | null {
  const filmstripPath = asset.derived.filmstripPath
  const frameCount = asset.derived.filmstripFrameCount ?? DEFAULT_FRAME_COUNT
  const { width, height } = asset.probe

  const cells = useMemo(
    () =>
      filmstripCells({
        clipWidthPx: widthPx,
        pixelsPerSecond,
        sourceInUs: clip.sourceInUs,
        speed: clip.speed,
        assetDurationUs: asset.probe.durationUs,
        frameCount,
        sourceAspect: width && height ? width / height : undefined,
        trackHeightPx
      }),
    [
      widthPx,
      pixelsPerSecond,
      clip.sourceInUs,
      clip.speed,
      asset.probe.durationUs,
      frameCount,
      width,
      height,
      trackHeightPx
    ]
  )

  if (!filmstripPath || cells.length === 0) return null
  const url = mediaFileUrl(filmstripPath)

  return (
    <div className="timeline-clip__filmstrip" aria-hidden>
      {cells.map((cell) => (
        <div
          key={cell.leftPx}
          className="timeline-clip__filmstrip-cell"
          style={{
            left: `${cell.leftPx}px`,
            width: `${cell.widthPx}px`,
            backgroundImage: `url(${url})`,
            // Chiều cao 'auto' để trình duyệt giữ đúng tỉ lệ THẬT của sprite;
            // phần thừa bị cắt đều trên dưới nhờ căn giữa.
            backgroundSize: `${frameCount * cell.widthPx}px auto`,
            backgroundPosition: `${-cell.tileIndex * cell.widthPx}px 50%`
          }}
        />
      ))}
    </div>
  )
}
