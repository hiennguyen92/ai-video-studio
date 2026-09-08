import { createRoot } from 'react-dom/client'
import { useEffect, useRef } from 'react'
import { Player, type PlayerRef } from '@remotion/player'
import { AffiliateShort, type Shot } from '../remotion-benchmark/affiliate-short'

/**
 * Trang đo tốc độ PREVIEW bằng Remotion Player.
 *
 * Xuất file nhanh hay chậm chỉ ảnh hưởng vài lần mỗi video; còn preview thì người
 * dùng tua và sửa hàng trăm lần mỗi buổi. Vì vậy hai con số cần biết là:
 *
 *   1. phát có giữ nổi 30fps thật không (đứng hình là không dựng được)
 *   2. tua tới một mốc mất bao lâu mới hiện đúng khung hình
 *
 * Trang này chỉ dựng Player và mở vài hàm đo ra `window` cho trình điều khiển
 * bên ngoài gọi vào.
 */

const FPS = 30
const DURATION_SECONDS = 25
const SHOT_COUNT = 8
const TRANSITION_FRAMES = 15

function buildShots(): Shot[] {
  const framesPerShot = Math.round((DURATION_SECONDS * FPS) / SHOT_COUNT) + TRANSITION_FRAMES
  return Array.from({ length: SHOT_COUNT }, (_, index) => ({
    src: 'nguon.mp4',
    fromSeconds: index * 3,
    durationInFrames: framesPerShot,
    caption: ['Cái này mình dùng mỗi ngày', 'Giá rẻ hơn bạn nghĩ nhiều', 'Chốt đơn ngay hôm nay'][
      index % 3
    ]
  }))
}

declare global {
  interface Window {
    __benchReady?: boolean
    __measurePlayback?: (ms: number) => Promise<{ effectiveFps: number; framesAdvanced: number }>
    __measureSeek?: (frames: number[]) => Promise<number[]>
    __seekPlainVideo?: (seconds: number) => void
  }
}

function Bench(): JSX.Element {
  const playerRef = useRef<PlayerRef>(null)

  useEffect(() => {
    /**
     * Đo tốc độ phát THỰC TẾ: đếm số khung hình Player đi được trong một khoảng
     * thời gian thật. Không dùng requestAnimationFrame để suy ra, vì rAF vẫn chạy
     * 60Hz kể cả khi video đứng hình.
     */
    window.__measurePlayback = async (ms) => {
      const player = playerRef.current
      if (!player) throw new Error('Player chưa sẵn sàng')

      player.seekTo(0)
      await new Promise((resolve) => setTimeout(resolve, 500))

      const startFrame = player.getCurrentFrame()
      const startTime = performance.now()
      player.play()
      await new Promise((resolve) => setTimeout(resolve, ms))
      player.pause()

      const elapsed = (performance.now() - startTime) / 1000
      const framesAdvanced = player.getCurrentFrame() - startFrame
      return { effectiveFps: framesAdvanced / elapsed, framesAdvanced }
    }

    /**
     * Đo độ trễ tua: từ lúc gọi `seekTo` tới lúc khung hình mới thật sự được vẽ.
     *
     * Chờ hai lần rAF rồi mới tính: một lần cho React cập nhật, một lần cho trình
     * duyệt vẽ xong. Đây là xấp xỉ, nhưng bám sát cảm nhận của người dùng hơn là
     * đo mỗi lời gọi hàm.
     */
    window.__measureSeek = async (frames) => {
      const player = playerRef.current
      if (!player) throw new Error('Player chưa sẵn sàng')
      player.pause()

      const timings: number[] = []
      for (const frame of frames) {
        const start = performance.now()
        player.seekTo(frame)
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
        timings.push(performance.now() - start)
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      return timings
    }

    /**
     * Mốc so sánh: tua một thẻ <video> trần trên cùng file.
     *
     * Cần con số này mới biết 0,5 giây kia là giá của Remotion hay chỉ là giá của
     * giải mã video — đường preview hiện tại của app cũng dùng thẻ video, nên nếu
     * hai bên ngang nhau thì Remotion không hề đắt hơn.
     */
    window.__seekPlainVideo = (seconds) => {
      const video = document.getElementById('plain') as HTMLVideoElement | null
      if (video) video.currentTime = seconds
    }

    window.__benchReady = true
  }, [])

  return (
    <>
    <Player
      ref={playerRef}
      component={AffiliateShort}
      inputProps={{ shots: buildShots(), transitionFrames: TRANSITION_FRAMES, showVideo: true }}
      durationInFrames={FPS * DURATION_SECONDS}
      fps={FPS}
      compositionWidth={1080}
      compositionHeight={1920}
      style={{ width: 540, height: 960 }}
      controls={false}
      acknowledgeRemotionLicense
    />
    {/* Thẻ video trần, cùng kích thước, để so bằng đúng một phương pháp đo. */}
    <video id="plain" src="/nguon.mp4" width={540} height={960} muted />
    </>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(<Bench />)
