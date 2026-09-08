import type { CSSProperties, JSX } from 'react'
import type {
  SubtitleCue,
  SubtitleStyle,
  SubtitleTrack
} from '../../../../shared/domain/subtitle-types'
import { wrapSubtitleText } from '../../../../shared/domain/subtitle-types'

/**
 * Vẽ phụ đề chồng lên khung xem trước.
 *
 * Style được suy ra từ CÙNG mô hình `SubtitleStyle` mà lớp export dùng để sinh
 * file ASS. Một mô hình, hai cách kết xuất — nhờ vậy đổi cỡ chữ hay vị trí ở
 * panel Phụ đề sẽ đổi cả bản xem trước lẫn bản nung vào video.
 *
 * Cỡ chữ được quy theo TỈ LỆ chiều cao khung hình, không phải pixel màn hình:
 * khung xem trước bị thu nhỏ theo panel, còn ASS tính theo độ phân giải thật.
 */

/** Alignment kiểu bàn phím số của ASS -> vị trí trong CSS. */
function alignmentToPosition(alignment: number): {
  justifyContent: CSSProperties['justifyContent']
  alignItems: CSSProperties['alignItems']
  textAlign: CSSProperties['textAlign']
} {
  const column = (alignment - 1) % 3 // 0 = trái, 1 = giữa, 2 = phải
  const row = Math.floor((alignment - 1) / 3) // 0 = dưới, 1 = giữa, 2 = trên

  return {
    justifyContent: row === 0 ? 'flex-end' : row === 1 ? 'center' : 'flex-start',
    alignItems: column === 0 ? 'flex-start' : column === 1 ? 'center' : 'flex-end',
    textAlign: column === 0 ? 'left' : column === 1 ? 'center' : 'right'
  }
}

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function textStyle(style: SubtitleStyle, stageHeight: number): CSSProperties {
  const relativeFontSize = `${(style.fontSizePx / stageHeight) * 100}cqh`
  const outline = style.outlineWidthPx / stageHeight

  return {
    fontFamily: `${style.fontFamily}, sans-serif`,
    fontSize: relativeFontSize,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.color,
    lineHeight: 1.25,
    padding: style.boxOpacity > 0 ? '0.15em 0.4em' : 0,
    borderRadius: style.boxOpacity > 0 ? '0.1em' : 0,
    background: style.boxOpacity > 0 ? hexToRgba(style.boxColor, style.boxOpacity) : 'transparent',
    // Viền chữ bằng bốn bóng đổ: `-webkit-text-stroke` cắt vào thân chữ nên với
    // dấu tiếng Việt (ắ, ề, ộ) nét dấu bị mỏng đi thấy rõ.
    textShadow:
      style.outlineWidthPx > 0
        ? [
            `${outline * 100}cqh 0 0 ${style.outlineColor}`,
            `-${outline * 100}cqh 0 0 ${style.outlineColor}`,
            `0 ${outline * 100}cqh 0 ${style.outlineColor}`,
            `0 -${outline * 100}cqh 0 ${style.outlineColor}`
          ].join(', ')
        : undefined,
    whiteSpace: 'pre-wrap'
  }
}

export function SubtitleOverlay({
  entries,
  stageHeight
}: {
  entries: Array<{ track: SubtitleTrack; cue: SubtitleCue }>
  stageHeight: number
}): JSX.Element | null {
  if (entries.length === 0) return null

  return (
    <>
      {entries.map(({ track, cue }) => {
        const position = alignmentToPosition(track.style.alignment)
        const lines = wrapSubtitleText(cue.text, track.style.maxCharsPerLine)
        const secondaryStyle = track.secondaryStyle ?? track.style
        const secondaryLines = cue.textSecondary
          ? wrapSubtitleText(cue.textSecondary, secondaryStyle.maxCharsPerLine)
          : []

        return (
          <div
            key={`${track.id}-${cue.id}`}
            className="subtitle-overlay"
            style={{
              ...position,
              paddingLeft: `${(track.style.marginLeftPx / stageHeight) * 100}cqh`,
              paddingRight: `${(track.style.marginRightPx / stageHeight) * 100}cqh`,
              paddingBottom: `${(track.style.marginVerticalPx / stageHeight) * 100}cqh`,
              paddingTop: `${(track.style.marginVerticalPx / stageHeight) * 100}cqh`
            }}
          >
            <div className="subtitle-overlay__block">
              <span
                style={{ ...textStyle(track.style, stageHeight), textAlign: position.textAlign }}
              >
                {lines.join('\n')}
              </span>
              {secondaryLines.length > 0 && (
                <span
                  style={{
                    ...textStyle(secondaryStyle, stageHeight),
                    textAlign: position.textAlign
                  }}
                >
                  {secondaryLines.join('\n')}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
