import { Composition, registerRoot } from 'remotion'
import { AffiliateShort, type Shot } from './affiliate-short'

/**
 * Điểm vào cho Remotion. Kích thước và nhịp hình đặt đúng chuẩn video dọc TikTok
 * (1080×1920 @ 30fps) — đo ở độ phân giải khác thì con số không dùng được.
 */

const FPS = 30

registerRoot(() => (
  <Composition
    id="affiliate-short"
    component={AffiliateShort}
    durationInFrames={FPS * 25}
    fps={FPS}
    width={1080}
    height={1920}
    defaultProps={{ shots: [] as Shot[], transitionFrames: 15, showVideo: true }}
  />
))
