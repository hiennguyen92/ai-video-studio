import { findClipLook } from '../shared/domain/clip-look-catalog'
import { ClipEffectFrame } from './clip-effect-frame'
import { CompositionMarkersContext, useCompositionMarkers } from './composition-markers'
import { buildLookFilterSvg, lookFilterId } from '../shared/domain/clip-look-svg'
import { useMemo, type CSSProperties, type JSX } from 'react'
import { TextOverlayFrameParts } from './text-overlay-frame'
import { frameBoxCss } from './text-overlay-frame-css'
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig
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
import { clipOffsetPx, fitInsideFrame } from '../shared/domain/clip-frame-fit'
import {
  combineTransitionStyles,
  transitionStyleAt,
  type TransitionStyle
} from '../shared/domain/clip-transition-style'
import { wrapSubtitleText } from '../shared/domain/subtitle-types'
import { textOverlayLines } from '../shared/domain/text-overlay-types'
import {
  alignmentToFlex,
  textTransformOrigin,
  type TextPosition
} from '../shared/domain/text-placement'

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
  /** Tắt dấu hiệu DOM (xem `composition-markers`). Bỏ trống = bật. */
  markers?: boolean
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
/** Kiểu của hiệu ứng VÀO ở khung hiện tại. */
function useEnterStyle(transition: RenderPlanVideoClip['transition']): TransitionStyle {
  const frame = useCurrentFrame()
  if (!transition) return { opacity: 1 }
  // 0 ở đầu chuyển cảnh, 1 khi đã hiện hẳn.
  const progress = interpolate(frame, [0, transition.frames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  })
  return transitionStyleAt(transition.kind, progress, frame)
}

/**
 * Kiểu của hiệu ứng RA ở khung hiện tại.
 *
 * Chạy NGƯỢC hiệu ứng vào: tiến độ đi từ 1 về 0 trong mấy khung cuối. Nhờ dùng
 * chung một bảng kiểu nên mười bốn kiểu chuyển cảnh đều có chiều ra, không phải
 * viết lại cái nào.
 */
function useExitStyle(
  transition: RenderPlanVideoClip['exitTransition'],
  durationInFrames: number
): TransitionStyle | null {
  const frame = useCurrentFrame()
  if (!transition || transition.frames <= 0) return null
  const progress = interpolate(
    frame,
    [durationInFrames - transition.frames, durationInFrames - 1],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  )
  return transitionStyleAt(transition.kind, progress, frame)
}

function VideoClip({
  clip,
  url,
  frame: frameSize
}: {
  clip: RenderPlanVideoClip
  url: string
  frame: { width: number; height: number }
}): JSX.Element {
  const markers = useCompositionMarkers()
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const fade = useFadeGain(clip.durationInFrames, clip.fadeInFrames, clip.fadeOutFrames)
  const enter = combineTransitionStyles(
    useEnterStyle(clip.transition),
    useExitStyle(clip.exitTransition, clip.durationInFrames)
  )
  const { transform } = clip

  // Chuyển động trong clip đi SAU biến đổi tĩnh: nó là chuyển động của khung hình
  // đã đặt đúng chỗ, không phải một cách đặt chỗ khác.
  const motion = motionTransformCss(motionTransformAt(clip.motion, frame, clip.durationInFrames))
  const offset = clipOffsetPx(transform, frameSize)
  // Ảnh vẽ đúng bằng chỗ nó chiếm, không căng ra cả khung: khung điều khiển trên
  // bản xem trước đo theo thẻ này.
  const fitted = clip.media === 'image' ? fitInsideFrame(clip.natural, frameSize) : frameSize

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
        // Ảnh vẽ đúng cỡ của nó nên phải canh giữa; `AbsoluteFill` là flex cột,
        // để mặc định thì ảnh dính góc trên-trái.
        justifyContent: 'center',
        alignItems: 'center',
        opacity: transform.opacity * fade * enter.opacity,
        clipPath: enter.clipPath,
        filter: enter.filter,
        // Dịch chuyển tính theo TỈ LỆ khung hình, không phải pixel: một đơn vị
        // là nửa khung. Dùng thẳng con số làm pixel thì kéo hết thanh trượt chỉ
        // dịch được một pixel, và ô chỉnh coi như không có tác dụng.
        transform: `${enter.transform ?? ''} translate(${offset.width}px, ${offset.height}px) scale(${transform.scale}) rotate(${transform.rotationDeg}deg) ${motion}`
      }}
    >
      {/*
        Ảnh tĩnh phải đi bằng `Img`, không phải `OffthreadVideo`.
        
        Đưa một tấm PNG cho `OffthreadVideo` thì Remotion không dựng ra gì cả —
        không lỗi, không cảnh báo, chỉ là một ô trống trong cả preview lẫn file
        xuất ra. Bộ lọc chỉnh màu đặt lên CHÍNH thẻ media chứ không lên khung
        bao: khung bao đã mang bộ lọc của chuyển cảnh, hai chỗ cùng đặt `filter`
        thì cái sau đè mất cái trước.
      */}
      <ClipEffectFrame
        // Id bộ lọc phải khác giữa hai Player trên cùng trang: `url(#id)` trỏ tới phần
        // tử ĐẦU TIÊN mang id đó, và bộ lọc của khung thu nhỏ tính theo cỡ khác.
        clipKey={markers ? clip.key : `thumb-${clip.key}`}
        effects={clip.effects}
        frame={frame}
        fps={fps}
        width={fitted.width}
        height={fitted.height}
      >
        {clip.media === 'image' ? (
          <Img
            src={url}
            data-clip-id={markers ? clip.key : undefined}
            style={{
              width: fitted.width,
              height: fitted.height,
              objectFit: 'contain',
              filter: mediaFilterCss(clip)
            }}
          />
        ) : (
          <OffthreadVideo
            src={url}
            data-clip-id={markers ? clip.key : undefined}
            startFrom={clip.sourceFromFrame}
            playbackRate={clip.playbackRate}
            volume={clip.muted ? 0 : clip.volume * fade}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              filter: mediaFilterCss(clip)
            }}
          />
        )}
      </ClipEffectFrame>

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

/**
 * Bộ lọc đặt lên chính thẻ media: chỉnh màu trước, look sau.
 *
 * Thứ tự này là thứ tự của mọi trình dựng: chỉnh phơi sáng/tương phản cho đúng
 * rồi mới áp LUT. Đảo lại thì kéo sáng làm lệch luôn màu của look.
 */
function mediaFilterCss(clip: RenderPlanVideoClip): string | undefined {
  const grade = colorGradeFilterCss(clip.colorGrade)
  const look = clip.look ? `url(#${lookFilterId(clip.look.id, clip.look.intensity)})` : ''
  return [grade, look].filter(Boolean).join(' ') || undefined
}

/**
 * Định nghĩa bộ lọc SVG cho mọi look đang dùng trong kế hoạch, mỗi (look, cường
 * độ) một lần. Nằm trong composition để bản xuất có đúng bộ lọc mà preview dùng.
 */
function LookFilterDefs({ plan }: { plan: RenderPlan }): JSX.Element | null {
  const markup = useMemo(() => {
    const seen = new Map<string, string>()
    for (const clip of plan.video) {
      if (!clip.look) continue
      const id = lookFilterId(clip.look.id, clip.look.intensity)
      const definition = findClipLook(clip.look.id)
      if (definition && !seen.has(id))
        seen.set(id, buildLookFilterSvg(definition, clip.look.intensity))
    }
    return [...seen.values()].join('')
  }, [plan.video])
  if (!markup) return null
  return (
    <svg
      aria-hidden
      width={0}
      height={0}
      style={{ position: 'absolute' }}
      dangerouslySetInnerHTML={{ __html: `<defs>${markup}</defs>` }}
    />
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

/**
 * Đặt khối chữ vào đúng một điểm khi người dùng đã kéo nó đi.
 *
 * Không có vị trí tự do thì trả về rỗng, để khung ngoài canh theo alignment như
 * cũ — dự án cũ mở lên không đổi một li nào.
 */
function freePlacementCss(position: TextPosition | undefined): CSSProperties {
  if (!position) return {}
  return {
    position: 'absolute',
    left: `${position.xPct * 100}%`,
    top: `${position.yPct * 100}%`,
    // Rộng đúng bằng nội dung. Phần tử đặt tuyệt đối mặc định chỉ được rộng tới
    // mép phải khung hình tính từ `left`, nên kéo chữ lại gần mép là trình duyệt
    // ép nó xuống hàng thành một cột. Ngắt dòng đã quyết xong ở tầng trên (Enter
    // người dùng gõ, thêm số ký tự với phụ đề) — kéo chữ đi đâu cũng phải giữ
    // nguyên các dòng đó.
    width: 'max-content'
  }
}

/**
 * Ghép chuỗi transform của khối chữ, ĐÚNG THỨ TỰ.
 *
 * CSS áp dụng từ PHẢI sang TRÁI, nên thứ tự ở đây là có chủ ý:
 *
 *   - `translate(-50%,-50%)` ngoài cùng, để đưa TÂM khối về đúng toạ độ đã chỉ.
 *     Đặt nó vào trong thì phép dời nửa khối bị xoay theo và chữ lệch đi.
 *   - transform của hiệu ứng vào/ra ở giữa, nên nó trượt theo trục màn hình.
 *   - `rotate` trong cùng, tức chạy trước mọi thứ, quanh `transform-origin`.
 *
 * Đo trong Chromium: `rotate(90deg) translateX(100px)` cho ra (0,100), còn
 * `translateX(100px) rotate(90deg)` cho ra (100,0).
 */
function composeTextTransform(
  position: TextPosition | undefined,
  animation: string | undefined,
  rotationDeg: number | undefined
): string | undefined {
  const parts = [
    position ? 'translate(-50%, -50%)' : '',
    animation ?? '',
    rotationDeg ? `rotate(${rotationDeg}deg)` : ''
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function SubtitleCue({ cue, height }: { cue: RenderPlanSubtitleCue; height: number }): JSX.Element {
  const markers = useCompositionMarkers()
  const { style } = cue
  // Ngắt dòng bằng đúng hàm mà lớp ghi file ASS dùng, để preview và bản nung
  // xuống dòng giống nhau.
  const lines = wrapSubtitleText(cue.text, style.maxCharsPerLine)
  const secondaryLines = cue.textSecondary
    ? wrapSubtitleText(cue.textSecondary, style.maxCharsPerLine)
    : []

  const { vertical, horizontal } = alignmentToFlex(style.alignment)
  const placement = freePlacementCss(style.position)

  const textStyle = {
    fontFamily: style.fontPostScriptName ?? style.fontFamily,
    fontSize: style.fontSizePx,
    // Chọn kiểu bằng tên PostScript rồi thì KHÔNG ép độ đậm nữa: chính kiểu đó
    // đã mang độ đậm của nó, ép thêm sẽ vẽ mọi kiểu trông như nhau và ô chọn kiểu
    // thành vô nghĩa.
    fontWeight: style.fontPostScriptName ? 'normal' : style.bold ? 800 : 500,
    fontStyle: style.fontPostScriptName ? 'normal' : style.italic ? 'italic' : 'normal',
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
      className={markers ? 'subtitle-cue' : undefined}
      // Id của cue, để khung điều khiển trên preview biết đo đúng khối nào khi
      // màn hình đang có nhiều khối chữ cùng lúc.
      data-block-id={markers ? cue.key : undefined}
      style={
        // Thả tự do thì lề và alignment không còn nghĩa gì — chính khối chữ tự
        // đặt chỗ. Lúc nung, thẻ `\an5\pos` cũng ghi đè đúng những thứ đó.
        style.position
          ? undefined
          : {
              justifyContent: vertical,
              alignItems: horizontal,
              paddingLeft: style.marginLeftPx,
              paddingRight: style.marginRightPx,
              paddingTop: vertical === 'flex-start' ? style.marginVerticalPx : 0,
              paddingBottom: vertical === 'flex-end' ? style.marginVerticalPx : 0
            }
      }
    >
      <div
        className={markers ? 'text-block' : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: style.lineSpacingPx,
          textAlign: 'center',
          ...placement,
          // Xoay CẢ KHỐI chứ không xoay từng dòng: xoay từng dòng thì các dòng
          // trượt khỏi nhau và khối chữ vỡ ra.
          transformOrigin: textTransformOrigin(style.alignment, style.position),
          transform: composeTextTransform(style.position, undefined, style.rotationDeg),
          backgroundColor:
            style.boxOpacity > 0 ? hexToRgba(style.boxColor, style.boxOpacity) : undefined,
          padding: style.boxOpacity > 0 ? height * 0.008 : 0
        }}
      >
        {lines.map((line, index) => (
          <span key={index} style={textStyle}>
            {visibleLine(line)}
          </span>
        ))}
        {secondaryLines.map((line, index) => (
          // Dòng phụ nhỏ hơn để phân biệt với dòng chính, giống bản nung.
          <span
            key={`secondary-${index}`}
            style={{ ...textStyle, fontSize: style.fontSizePx * 0.75 }}
          >
            {visibleLine(line)}
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
  const markers = useCompositionMarkers()
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

  // Chữ overlay KHÔNG tự ngắt theo số ký tự — chỉ xuống dòng ở chỗ người dùng
  // gõ Enter. Xem `textOverlayLines`.
  const lines = textOverlayLines(visibleText)
  const { vertical, horizontal } = alignmentToFlex(style.alignment)
  const placement = freePlacementCss(style.position)

  return (
    <AbsoluteFill
      className={markers ? 'text-overlay' : undefined}
      data-block-id={markers ? overlay.key : undefined}
      style={
        style.position
          ? { opacity }
          : {
              justifyContent: vertical,
              alignItems: horizontal,
              paddingLeft: style.marginLeftPx,
              paddingRight: style.marginRightPx,
              paddingTop: vertical === 'flex-start' ? style.marginVerticalPx : 0,
              paddingBottom: vertical === 'flex-end' ? style.marginVerticalPx : 0,
              opacity
            }
      }
    >
      <div
        className={markers ? 'text-block' : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: style.lineSpacingPx,
          textAlign: 'center',
          transformOrigin: textTransformOrigin(style.alignment, style.position),
          transform: composeTextTransform(style.position, transform, style.rotationDeg),
          backgroundColor:
            style.boxOpacity > 0 ? hexToRgba(style.boxColor, style.boxOpacity) : undefined,
          padding: style.boxOpacity > 0 ? style.fontSizePx * 0.25 : 0,
          borderRadius: style.boxOpacity > 0 ? style.fontSizePx * 0.12 : 0,
          // Có khung thì khung NUỐT nền hộp phẳng, không cộng thêm vào nó. Hai
          // thứ vẽ chồng lên nhau ra một hình chữ nhật xám nằm chèn trong khung
          // mây. Giao diện chỉ cho chọn một trong hai, nhưng đường MCP đặt được
          // cả hai bằng hai lệnh rời — nên lớp vẽ phải tự chốt lấy.
          ...(overlay.frame ? frameBoxCss(overlay.frame, style.fontSizePx) : {}),
          // ĐẶT VỊ TRÍ SAU CÙNG, và đây là thứ tự có chủ ý. Khung đặt
          // `position: relative` để đuôi và trang trí có chỗ bám; ghim vị trí thì
          // cần `position: absolute`. Để khung ghi sau thì chữ đã ghim rơi lại
          // vào luồng flex, giãn hết chiều ngang và nằm sai chỗ.
          //
          // Cả `relative` lẫn `absolute` đều làm gốc bám cho phần tử con đặt
          // tuyệt đối, nên nhường quyền cho phần đặt vị trí không mất gì.
          ...placement
        }}
      >
        {overlay.frame && (
          <TextOverlayFrameParts frame={overlay.frame} fontSizePx={style.fontSizePx} />
        )}
        {lines.map((line, index) => (
          <span
            key={index}
            style={{
              fontFamily: style.fontPostScriptName ?? style.fontFamily,
              fontSize: style.fontSizePx,
              fontWeight: style.fontPostScriptName ? 'normal' : style.bold ? 800 : 500,
              fontStyle: style.fontPostScriptName ? 'normal' : style.italic ? 'italic' : 'normal',
              color: style.color,
              lineHeight: 1.15,
              // Không để trình duyệt ngắt hộ khi dòng chạm mép khung hình: dòng
              // nào người dùng gõ ra thì dòng đó nằm nguyên một dòng, dài quá thì
              // tràn ra ngoài — thấy ngay để còn hạ cỡ chữ, chứ không âm thầm bị
              // bẻ đôi.
              whiteSpace: 'nowrap',
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
            {visibleLine(line)}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  )
}

/**
 * Dòng trống (người dùng Enter hai lần) phải còn chiều cao: một `<span>` rỗng cao
 * bằng 0, và khoảng cách giữa hai đoạn biến mất trên hình.
 */
function visibleLine(line: string): string {
  return line === '' ? '\u00A0' : line
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const red = parseInt(value.slice(0, 2), 16)
  const green = parseInt(value.slice(2, 4), 16)
  const blue = parseInt(value.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function ProjectComposition({
  plan,
  mediaUrls,
  markers = true
}: ProjectCompositionProps): JSX.Element {
  /**
   * Mọi lớp NHÌN THẤY xếp chung một hàng, theo đúng thứ tự lane trên timeline.
   *
   * Trước đây thứ tự cứng: hình trước, rồi phụ đề, rồi chữ. Đặt lane chữ lên
   * trên lane hình trong timeline cũng không đổi được gì, vì lớp vẽ không nhìn
   * tới thứ tự đó. Nay lane trên cùng vẽ trước nên nằm dưới, lane dưới cùng vẽ
   * sau nên nằm trên — một luật cho cả bốn loại.
   *
   * Cùng một lane thì giữ nguyên thứ tự trong kế hoạch; so thêm chỉ số gốc vì
   * không phải công cụ nào cũng đảm bảo `sort` ổn định.
   */
  const layers: Array<{ layerIndex: number; order: number; node: JSX.Element }> = []
  const push = (layerIndex: number, node: JSX.Element): void => {
    layers.push({ layerIndex, order: layers.length, node })
  }

  for (const clip of plan.video) {
    const url = mediaUrls[clip.assetId]
    if (!url) continue
    push(
      clip.layerIndex,
      <Sequence
        key={`clip-${clip.key}`}
        from={clip.fromFrame}
        durationInFrames={clip.durationInFrames}
      >
        <VideoClip clip={clip} url={url} frame={{ width: plan.width, height: plan.height }} />
      </Sequence>
    )
  }

  for (const cue of plan.subtitles) {
    push(
      cue.layerIndex,
      <Sequence key={`cue-${cue.key}`} from={cue.fromFrame} durationInFrames={cue.durationInFrames}>
        <SubtitleCue cue={cue} height={plan.height} />
      </Sequence>
    )
  }

  for (const overlay of plan.textOverlays) {
    push(
      overlay.layerIndex,
      <Sequence
        key={`text-${overlay.key}`}
        from={overlay.fromFrame}
        durationInFrames={overlay.durationInFrames}
      >
        <TextOverlayLayer overlay={overlay} />
      </Sequence>
    )
  }

  layers.sort((left, right) => left.layerIndex - right.layerIndex || left.order - right.order)

  return (
    <CompositionMarkersContext.Provider value={markers}>
      <AbsoluteFill style={{ backgroundColor: plan.backgroundColor }}>
        <LookFilterDefs plan={plan} />
        {layers.map((layer) => layer.node)}

        {/* Tiếng không có lớp: nghe được thì nghe, không che gì của ai. */}
        {plan.audio.map((clip) => {
          const url = mediaUrls[clip.assetId]
          if (!url) return null
          return (
            <Sequence key={clip.key} from={clip.fromFrame} durationInFrames={clip.durationInFrames}>
              <AudioClip clip={clip} url={url} />
            </Sequence>
          )
        })}
      </AbsoluteFill>
    </CompositionMarkersContext.Provider>
  )
}
