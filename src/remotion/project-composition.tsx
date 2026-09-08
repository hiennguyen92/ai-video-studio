import type { JSX } from 'react'
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame
} from 'remotion'
import type {
  RenderPlan,
  RenderPlanAudioClip,
  RenderPlanSubtitleCue,
  RenderPlanTextOverlay,
  RenderPlanVideoClip
} from '../shared/domain/remotion-render-plan'
import {
  colorGradeFilterCss,
  temperatureOverlay,
  vignetteBackgroundCss
} from '../shared/domain/clip-color-grade'
import { motionTransformAt, motionTransformCss } from '../shared/domain/clip-motion-types'
import { wrapSubtitleText } from '../shared/domain/subtitle-types'

/**
 * Composition vẽ lại một bản dựng.
 *
 * Đây là NGUỒN HÌNH DUY NHẤT: `@remotion/player` dùng nó cho preview, và
 * `renderMedia` dùng đúng nó khi xuất file. Không có hai đường vẽ song song để
 * lệch nhau (DESCRIPTION §4).
 *
 * Component cố ý "ngu": mọi phép tính thời gian đã xong ở `buildRenderPlan`.
 * Ở đây chỉ còn đặt phần tử lên đúng khung hình.
 *
 * Media đi qua URL http của máy chủ cục bộ, không phải đường dẫn đĩa — bộ dựng
 * khung hình của Remotion là tiến trình riêng và không đọc được file tuỳ ý.
 */

/**
 * Khai bằng `type` chứ không phải `interface` là CÓ CHỦ Ý: `Composition` của
 * Remotion đòi props gán được vào `Record<string, unknown>`, mà interface trong
 * TypeScript không có index signature ngầm còn type alias thì có.
 */
export type ProjectCompositionProps = {
  plan: RenderPlan
  /** id asset -> URL http. Thiếu URL thì phần tử đó không vẽ được. */
  mediaUrls: Record<string, string>
}

/**
 * Hệ số fade tại khung hiện tại.
 *
 * Giữ đúng ngữ nghĩa của lớp preview cũ: fade in tính từ đầu clip, fade out tính
 * ngược từ cuối, và hai fade nhân với nhau khi clip quá ngắn nên chúng chồng nhau.
 */
function useFadeGain(
  durationInFrames: number,
  fadeInFrames: number,
  fadeOutFrames: number
): number {
  const frame = useCurrentFrame()
  let gain = 1

  if (fadeInFrames > 0) {
    gain *= interpolate(frame, [0, fadeInFrames], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    })
  }
  if (fadeOutFrames > 0) {
    gain *= interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp'
    })
  }
  return gain
}

/**
 * Kiểu vẽ cho hiệu ứng xuất hiện, tại khung hiện tại.
 *
 * Mọi hiệu ứng đều tác động lên CHÍNH clip đến, phủ dần lên clip phía dưới. Không
 * có phép trộn hai luồng, nên chúng chạy được bằng CSS thuần và giống hệt nhau ở
 * preview lẫn lúc xuất.
 */
function useTransitionStyle(transition: RenderPlanVideoClip['transition']): {
  opacity: number
  transform?: string
  clipPath?: string
  filter?: string
} {
  const frame = useCurrentFrame()
  if (!transition) return { opacity: 1 }

  // 0 ở đầu chuyển cảnh, 1 khi đã hiện hẳn.
  const progress = interpolate(frame, [0, transition.frames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  const offset = (1 - progress) * 100

  switch (transition.kind) {
    case 'fade':
      return { opacity: progress }
    case 'slide-left':
      return { opacity: 1, transform: `translateX(${offset}%)` }
    case 'slide-right':
      return { opacity: 1, transform: `translateX(${-offset}%)` }
    case 'slide-up':
      return { opacity: 1, transform: `translateY(${offset}%)` }
    case 'slide-down':
      return { opacity: 1, transform: `translateY(${-offset}%)` }
    case 'wipe-left':
      // Lộ dần từ mép phải sang trái; phần chưa lộ bị cắt đi chứ không mờ.
      return { opacity: 1, clipPath: `inset(0 0 0 ${offset}%)` }
    case 'wipe-right':
      return { opacity: 1, clipPath: `inset(0 ${offset}% 0 0)` }
    case 'zoom':
      return { opacity: progress, transform: `scale(${1 + (1 - progress) * 0.25})` }

    // Lia vụt: trượt nhanh hơn hẳn slide và kèm mờ chuyển động. Không có phần mờ
    // thì nó chỉ là một cú trượt nhanh, mất hẳn cảm giác "vụt".
    case 'whip-left':
      return {
        opacity: 1,
        transform: `translateX(${offset * 1.4}%)`,
        filter: `blur(${(1 - progress) * 14}px)`
      }
    case 'whip-right':
      return {
        opacity: 1,
        transform: `translateX(${-offset * 1.4}%)`,
        filter: `blur(${(1 - progress) * 14}px)`
      }

    case 'blur':
      return { opacity: progress, filter: `blur(${(1 - progress) * 26}px)` }

    case 'glitch': {
      // Giật ngang theo khung hình chứ không theo tiến độ: nhiễu phải rời rạc,
      // nội suy mượt sẽ thành một cú trượt chứ không phải nhiễu.
      const jitter = Math.sin(frame * 13.7) * (1 - progress) * 4
      return {
        opacity: 1,
        transform: `translateX(${jitter}%)`,
        filter: `hue-rotate(${Math.sin(frame * 7.3) * (1 - progress) * 90}deg) saturate(${1 + (1 - progress) * 2})`
      }
    }

    case 'spin':
      return {
        opacity: progress,
        transform: `rotate(${(1 - progress) * -14}deg) scale(${1 + (1 - progress) * 0.35})`
      }

    case 'flash':
      // Loé rồi tắt nhanh: dùng luỹ thừa để phần sáng chỉ chiếm đoạn đầu, không
      // kéo trắng suốt cả chuyển cảnh.
      return { opacity: 1, filter: `brightness(${1 + (1 - progress) ** 2 * 6})` }
  }
}

function VideoClip({ clip, url }: { clip: RenderPlanVideoClip; url: string }): JSX.Element {
  const frame = useCurrentFrame()
  const fade = useFadeGain(clip.durationInFrames, clip.fadeInFrames, clip.fadeOutFrames)
  const enter = useTransitionStyle(clip.transition)
  const { transform } = clip

  // Chuyển động trong clip đi SAU biến đổi tĩnh: nó là chuyển động của khung hình
  // đã đặt đúng chỗ, không phải một cách đặt chỗ khác.
  const motion = motionTransformCss(motionTransformAt(clip.motion, frame, clip.durationInFrames))

  // Ám màu và tối góc nằm TRONG khung bao nên chúng đi theo chuyển động của clip.
  // Đó là hành vi đúng cho hiệu ứng gắn với clip: chỉnh màu là chỉnh chính hình
  // đó, không phải chỉnh khung ngắm.
  const temperature = temperatureOverlay(clip.colorGrade)
  const vignette = vignetteBackgroundCss(clip.colorGrade)

  return (
    <AbsoluteFill
      // Biến đổi của chuyển cảnh đi TRƯỚC biến đổi của clip: hiệu ứng vào phải
      // tác động lên khung hình đã đặt đúng vị trí, không phải ngược lại.
      style={{
        opacity: transform.opacity * fade * enter.opacity,
        clipPath: enter.clipPath,
        filter: enter.filter,
        transform: `${enter.transform ?? ''} translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotationDeg}deg) ${motion}`
      }}
    >
      <OffthreadVideo
        src={url}
        startFrom={clip.sourceFromFrame}
        playbackRate={clip.playbackRate}
        volume={clip.muted ? 0 : clip.volume * fade}
        // Bộ lọc chỉnh màu đặt lên CHÍNH thẻ video, không đặt lên khung bao:
        // khung bao đã mang bộ lọc của chuyển cảnh, hai chỗ cùng đặt `filter` thì
        // cái sau đè mất cái trước.
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          filter: colorGradeFilterCss(clip.colorGrade)
        }}
      />

      {temperature && (
        <AbsoluteFill
          style={{
            backgroundColor: temperature.color,
            opacity: temperature.opacity,
            mixBlendMode: temperature.blendMode,
            pointerEvents: 'none'
          }}
        />
      )}

      {vignette && <AbsoluteFill style={{ background: vignette, pointerEvents: 'none' }} />}
    </AbsoluteFill>
  )
}

function AudioClip({ clip, url }: { clip: RenderPlanAudioClip; url: string }): JSX.Element {
  const fade = useFadeGain(clip.durationInFrames, clip.fadeInFrames, clip.fadeOutFrames)
  return (
    <Audio
      src={url}
      startFrom={clip.sourceFromFrame}
      playbackRate={clip.playbackRate}
      volume={clip.volume * fade}
    />
  )
}

function SubtitleCue({ cue, height }: { cue: RenderPlanSubtitleCue; height: number }): JSX.Element {
  const { style } = cue
  // Ngắt dòng bằng đúng hàm mà lớp ghi file ASS dùng, để preview và bản nung
  // xuống dòng giống nhau.
  const lines = wrapSubtitleText(cue.text, style.maxCharsPerLine)
  const secondaryLines = cue.textSecondary
    ? wrapSubtitleText(cue.textSecondary, style.maxCharsPerLine)
    : []

  // Alignment kiểu bàn phím số của ASS: 1–3 dưới, 4–6 giữa, 7–9 trên.
  const vertical =
    style.alignment >= 7 ? 'flex-start' : style.alignment >= 4 ? 'center' : 'flex-end'
  const horizontal =
    style.alignment % 3 === 1 ? 'flex-start' : style.alignment % 3 === 2 ? 'center' : 'flex-end'

  const textStyle = {
    fontFamily: style.fontFamily,
    fontSize: style.fontSizePx,
    fontWeight: style.bold ? 800 : 500,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.color,
    lineHeight: 1.25,
    // Viền chữ: cách duy nhất khớp được với outline của ASS bằng CSS thuần.
    WebkitTextStroke:
      style.outlineWidthPx > 0 ? `${style.outlineWidthPx}px ${style.outlineColor}` : undefined,
    paintOrder: 'stroke fill' as const,
    textShadow:
      style.shadowPx > 0 ? `0 ${style.shadowPx}px ${style.shadowPx * 2}px #000` : undefined
  }

  return (
    <AbsoluteFill
      // Class ổn định để gỡ lỗi và để kiểm thử bám vào; Remotion không tự đặt.
      className="subtitle-cue"
      style={{
        justifyContent: vertical,
        alignItems: horizontal,
        paddingLeft: style.marginLeftPx,
        paddingRight: style.marginRightPx,
        paddingTop: vertical === 'flex-start' ? style.marginVerticalPx : 0,
        paddingBottom: vertical === 'flex-end' ? style.marginVerticalPx : 0
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: style.lineSpacingPx,
          textAlign: 'center',
          backgroundColor:
            style.boxOpacity > 0 ? hexToRgba(style.boxColor, style.boxOpacity) : undefined,
          padding: style.boxOpacity > 0 ? height * 0.008 : 0
        }}
      >
        {lines.map((line, index) => (
          <span key={index} style={textStyle}>
            {line}
          </span>
        ))}
        {secondaryLines.map((line, index) => (
          // Dòng phụ nhỏ hơn để phân biệt với dòng chính, giống bản nung.
          <span
            key={`secondary-${index}`}
            style={{ ...textStyle, fontSize: style.fontSizePx * 0.75 }}
          >
            {line}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}

/**
 * Chữ overlay: hook, giá, lời kêu gọi hành động.
 *
 * Vẽ TRÊN CÙNG, sau cả phụ đề — hook mà bị phụ đề che thì mất tác dụng.
 *
 * Hiệu ứng gõ chữ cắt theo SỐ KÝ TỰ chứ không dùng chiều rộng, để nó chạy giống
 * nhau ở mọi cỡ chữ và mọi phông.
 */
function TextOverlayLayer({ overlay }: { overlay: RenderPlanTextOverlay }): JSX.Element {
  const frame = useCurrentFrame()
  const { style } = overlay

  const progress =
    overlay.animationFrames > 0
      ? interpolate(frame, [0, overlay.animationFrames], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        })
      : 1

  // Tiến độ hiệu ứng RA: 0 khi chưa tới lúc ra, 1 ở khung cuối cùng.
  const exitProgress =
    overlay.exitFrames > 0
      ? interpolate(
          frame,
          [overlay.durationInFrames - overlay.exitFrames, overlay.durationInFrames - 1],
          [0, 1],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
        )
      : 0

  let opacity = 1
  let transform: string | undefined
  let visibleText = overlay.text

  switch (overlay.animation) {
    case 'fade':
      opacity = progress
      break
    case 'pop':
      // Nảy quá cỡ rồi về đúng cỡ — kiểu chữ hay thấy ở video ngắn.
      opacity = progress
      transform = `scale(${interpolate(progress, [0, 0.6, 1], [0.6, 1.12, 1])})`
      break
    case 'slide-up':
      opacity = progress
      transform = `translateY(${(1 - progress) * 40}px)`
      break
    case 'typewriter':
      visibleText = overlay.text.slice(0, Math.ceil(progress * overlay.text.length))
      break
    case 'none':
      break
  }

  // Hiệu ứng ra NHÂN vào kết quả của hiệu ứng vào, không ghi đè: overlay ngắn có
  // thể đang trong cả hai giai đoạn, và ghi đè sẽ làm chữ nhảy về rõ hẳn rồi mới
  // biến mất.
  switch (overlay.exitAnimation) {
    case 'fade':
      opacity *= 1 - exitProgress
      break
    case 'shrink':
      opacity *= 1 - exitProgress
      transform = `${transform ?? ''} scale(${1 - exitProgress * 0.35})`
      break
    case 'slide-down':
      opacity *= 1 - exitProgress
      transform = `${transform ?? ''} translateY(${exitProgress * 40}px)`
      break
    case 'none':
      break
  }

  const lines = wrapSubtitleText(visibleText, style.maxCharsPerLine)
  const vertical =
    style.alignment >= 7 ? 'flex-start' : style.alignment >= 4 ? 'center' : 'flex-end'
  const horizontal =
    style.alignment % 3 === 1 ? 'flex-start' : style.alignment % 3 === 2 ? 'center' : 'flex-end'

  return (
    <AbsoluteFill
      className="text-overlay"
      style={{
        justifyContent: vertical,
        alignItems: horizontal,
        paddingLeft: style.marginLeftPx,
        paddingRight: style.marginRightPx,
        paddingTop: vertical === 'flex-start' ? style.marginVerticalPx : 0,
        paddingBottom: vertical === 'flex-end' ? style.marginVerticalPx : 0,
        opacity
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: style.lineSpacingPx,
          textAlign: 'center',
          transform,
          backgroundColor:
            style.boxOpacity > 0 ? hexToRgba(style.boxColor, style.boxOpacity) : undefined,
          padding: style.boxOpacity > 0 ? style.fontSizePx * 0.25 : 0,
          borderRadius: style.boxOpacity > 0 ? style.fontSizePx * 0.12 : 0
        }}
      >
        {lines.map((line, index) => (
          <span
            key={index}
            style={{
              fontFamily: style.fontFamily,
              fontSize: style.fontSizePx,
              fontWeight: style.bold ? 800 : 500,
              fontStyle: style.italic ? 'italic' : 'normal',
              color: style.color,
              lineHeight: 1.15,
              WebkitTextStroke:
                style.outlineWidthPx > 0
                  ? `${style.outlineWidthPx}px ${style.outlineColor}`
                  : undefined,
              paintOrder: 'stroke fill',
              // Phát sáng chồng ba lớp bóng cùng màu chữ: một lớp duy nhất nhìn
              // ra vệt mờ chứ không ra quầng sáng.
              textShadow: overlay.glow
                ? `0 0 ${style.fontSizePx * 0.12}px ${style.color}, 0 0 ${style.fontSizePx * 0.28}px ${style.color}, 0 0 ${style.fontSizePx * 0.5}px ${style.color}`
                : undefined
            }}
          >
            {line}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function ProjectComposition({ plan, mediaUrls }: ProjectCompositionProps): JSX.Element {
  return (
    <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
      {plan.video.map((clip) => {
        const url = mediaUrls[clip.assetId]
        if (!url) return null
        return (
          <Sequence key={clip.key} from={clip.fromFrame} durationInFrames={clip.durationInFrames}>
            <VideoClip clip={clip} url={url} />
          </Sequence>
        )
      })}

      {plan.audio.map((clip) => {
        const url = mediaUrls[clip.assetId]
        if (!url) return null
        return (
          <Sequence key={clip.key} from={clip.fromFrame} durationInFrames={clip.durationInFrames}>
            <AudioClip clip={clip} url={url} />
          </Sequence>
        )
      })}

      {plan.subtitles.map((cue) => (
        <Sequence key={cue.key} from={cue.fromFrame} durationInFrames={cue.durationInFrames}>
          <SubtitleCue cue={cue} height={plan.height} />
        </Sequence>
      ))}

      {/* Sau phụ đề: hook và CTA phải nằm trên cùng mới đọc được. */}
      {plan.textOverlays.map((overlay) => (
        <Sequence
          key={overlay.key}
          from={overlay.fromFrame}
          durationInFrames={overlay.durationInFrames}
        >
          <TextOverlayLayer overlay={overlay} />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
