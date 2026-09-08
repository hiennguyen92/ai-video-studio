import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame
} from 'remotion'

/**
 * Bản dựng mẫu mô phỏng ĐÚNG loại video định làm: aff TikTok dọc, cắt nhanh,
 * có chuyển cảnh mờ và phụ đề nảy chữ.
 *
 * Đo bằng một composition quá đơn giản sẽ ra con số đẹp nhưng vô nghĩa. Ở đây
 * cố ý gộp đủ ba thứ tốn kém: giải mã video, chồng hai luồng video lúc chuyển
 * cảnh, và chữ động vẽ lại mỗi khung hình.
 */

export interface Shot {
  src: string
  /**
   * Tên file trong thư mục public.
   *
   * Remotion KHÔNG đọc được đường dẫn tuỳ ý trên đĩa — asset phải nằm dưới
   * publicDir hoặc được phục vụ qua HTTP. Với một trình dựng phim mà media nằm
   * khắp nơi, đây là ràng buộc phải xử lý khi tích hợp thật.
   */
  /** Giây bắt đầu trong file nguồn. */
  fromSeconds: number
  durationInFrames: number
  caption: string
}

export interface AffiliateShortProps {
  shots: Shot[]
  transitionFrames: number
  /**
   * Tắt để render RIÊNG lớp chữ trên nền trong suốt.
   *
   * Đây là phương án lai: ffmpeg lo phần video, Remotion chỉ lo đồ hoạ, rồi ghép
   * hai lớp lại. Cần biết lớp đồ hoạ một mình tốn bao nhiêu mới quyết được.
   */
  showVideo: boolean
}

/** Phụ đề nảy chữ: mỗi từ bật lên rồi về kích thước thường. */
function PoppingCaption({ text, startFrame }: { text: string; startFrame: number }): JSX.Element {
  const frame = useCurrentFrame()
  const words = text.split(' ')
  // Mỗi từ chiếm 6 khung; đây là kiểu caption TikTok hay dùng.
  const perWord = 6

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 320,
        left: 60,
        right: 60,
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 14,
        fontFamily: 'Helvetica, Arial, sans-serif',
        fontWeight: 800,
        fontSize: 68,
        color: 'white',
        textShadow: '0 4px 18px rgba(0,0,0,0.85)'
      }}
    >
      {words.map((word, index) => {
        const wordFrame = frame - startFrame - index * perWord
        const scale = interpolate(wordFrame, [0, 4, 10], [0.7, 1.15, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        })
        const active = wordFrame >= 0
        return (
          <span
            key={index}
            style={{
              transform: `scale(${active ? scale : 0.7})`,
              opacity: active ? 1 : 0.25,
              color: active && wordFrame < 12 ? '#FFE45C' : 'white'
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

export function AffiliateShort({
  shots,
  transitionFrames,
  showVideo
}: AffiliateShortProps): JSX.Element {
  let cursor = 0

  return (
    <AbsoluteFill style={{ backgroundColor: showVideo ? 'black' : 'transparent' }}>
      {shots.map((shot, index) => {
        const from = cursor
        // Chồng lấn để tạo crossfade — chính chỗ này bắt máy giải mã HAI video
        // cùng lúc, và là phần tốn kém nhất của bản dựng.
        cursor += shot.durationInFrames - (index < shots.length - 1 ? transitionFrames : 0)

        return (
          <Sequence key={index} from={from} durationInFrames={shot.durationInFrames}>
            <ShotLayer
              shot={shot}
              transitionFrames={transitionFrames}
              isFirst={index === 0}
              showVideo={showVideo}
            />
          </Sequence>
        )
      })}
    </AbsoluteFill>
  )
}

function ShotLayer({
  shot,
  transitionFrames,
  isFirst,
  showVideo
}: {
  shot: Shot
  transitionFrames: number
  isFirst: boolean
  showVideo: boolean
}): JSX.Element {
  const frame = useCurrentFrame()
  // Mờ dần vào; cảnh đầu không cần vì không có gì phía trước để hoà vào.
  const opacity = isFirst
    ? 1
    : interpolate(frame, [0, transitionFrames], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
      })

  return (
    <AbsoluteFill style={{ opacity }}>
      {showVideo && (
        <OffthreadVideo
          src={staticFile(shot.src)}
          startFrom={Math.round(shot.fromSeconds * 30)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      <PoppingCaption text={shot.caption} startFrame={0} />
    </AbsoluteFill>
  )
}
