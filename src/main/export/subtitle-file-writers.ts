import { writeFile } from 'node:fs/promises'
import type { Micros } from '../../shared/domain/time-units'
import type { SubtitleStyle, SubtitleTrack } from '../../shared/domain/subtitle-types'
import { wrapSubtitleText } from '../../shared/domain/subtitle-types'

/**
 * Ghi phụ đề ra file SRT (xuất riêng) và ASS (để nung vào hình).
 *
 * ASS được chọn cho burn-in vì SRT không mang thông tin style: cỡ chữ, viền,
 * vị trí, nền hộp đều mất. Dùng ASS thì bản nung vào video mới giống bản xem trước.
 */

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/** SRT dùng dấu phẩy ngăn mili giây: HH:MM:SS,mmm */
export function formatSrtTime(us: Micros): string {
  const totalMs = Math.round(us / 1000)
  const ms = totalMs % 1000
  const totalSeconds = Math.floor(totalMs / 1000)
  return (
    `${pad(Math.floor(totalSeconds / 3600), 2)}:` +
    `${pad(Math.floor(totalSeconds / 60) % 60, 2)}:` +
    `${pad(totalSeconds % 60, 2)},${pad(ms, 3)}`
  )
}

/** ASS dùng phần trăm giây và chỉ một chữ số giờ: H:MM:SS.cc */
export function formatAssTime(us: Micros): string {
  const totalCs = Math.round(us / 10_000)
  const cs = totalCs % 100
  const totalSeconds = Math.floor(totalCs / 100)
  return (
    `${Math.floor(totalSeconds / 3600)}:` +
    `${pad(Math.floor(totalSeconds / 60) % 60, 2)}:` +
    `${pad(totalSeconds % 60, 2)}.${pad(cs, 2)}`
  )
}

/**
 * Màu ASS là &HAABBGGRR — alpha trước, rồi BGR ngược so với web #RRGGBB.
 * Alpha cũng ngược: 00 là ĐẶC, FF là trong suốt hoàn toàn.
 */
export function toAssColor(hex: string, opacity = 1): string {
  const value = hex.replace('#', '').padEnd(6, '0')
  const r = value.slice(0, 2)
  const g = value.slice(2, 4)
  const b = value.slice(4, 6)
  const alpha = Math.round((1 - Math.max(0, Math.min(1, opacity))) * 255)
  const alphaHex = alpha.toString(16).padStart(2, '0')
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase()
}

function assStyleLine(name: string, style: SubtitleStyle): string {
  // BorderStyle 3 vẽ nền hộp đặc, 1 vẽ viền chữ + bóng đổ.
  const borderStyle = style.boxOpacity > 0 ? 3 : 1
  return [
    `Style: ${name}`,
    // Tên PostScript trỏ đúng MỘT kiểu; tên họ thì để libass tự chọn kiểu, và nó
    // hay chọn kiểu thường trong khi preview đang vẽ kiểu khác.
    style.fontPostScriptName ?? style.fontFamily,
    String(style.fontSizePx),
    toAssColor(style.color),
    toAssColor(style.color),
    toAssColor(style.outlineColor),
    toAssColor(style.boxColor, style.boxOpacity),
    // Chọn kiểu bằng tên PostScript rồi thì để libass dùng đúng kiểu đó, đừng bật
    // thêm cờ đậm/nghiêng — nó sẽ làm đậm giả chồng lên một kiểu vốn đã đậm.
    style.fontPostScriptName ? '0' : style.bold ? '-1' : '0',
    style.fontPostScriptName ? '0' : style.italic ? '-1' : '0',
    '0',
    '0',
    '100',
    '100',
    '0',
    '0',
    String(borderStyle),
    String(style.outlineWidthPx),
    String(style.shadowPx),
    String(style.alignment),
    String(style.marginLeftPx),
    String(style.marginRightPx),
    String(style.marginVerticalPx),
    // Encoding 1 = mặc định; libass tự nhận UTF-8 nên dấu tiếng Việt hiển thị đủ.
    '1'
  ].join(',')
}

export function renderAss(track: SubtitleTrack, videoWidth: number, videoHeight: number): string {
  const secondaryStyle = track.secondaryStyle ?? {
    ...track.style,
    fontSizePx: Math.round(track.style.fontSizePx * 0.78)
  }

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    // PlayRes phải khớp độ phân giải xuất, nếu không libass sẽ co giãn chữ sai tỉ lệ.
    `PlayResX: ${videoWidth}`,
    `PlayResY: ${videoHeight}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    assStyleLine('Chinh', track.style),
    assStyleLine('Phu', secondaryStyle),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ]

  const events = track.cues.flatMap((cue) => {
    const start = formatAssTime(cue.startUs)
    const end = formatAssTime(cue.endUs)
    const lines: string[] = []

    const primary = wrapSubtitleText(cue.text, track.style.maxCharsPerLine).join('\\N')
    if (primary) {
      lines.push(`Dialogue: 0,${start},${end},Chinh,,0,0,0,,${escapeAssText(primary)}`)
    }

    if (cue.textSecondary) {
      const secondary = wrapSubtitleText(cue.textSecondary, secondaryStyle.maxCharsPerLine).join(
        '\\N'
      )
      // Layer 1 để dòng thứ hai vẽ chồng lên dòng chính khi hai bên trùng vị trí.
      lines.push(`Dialogue: 1,${start},${end},Phu,,0,0,0,,${escapeAssText(secondary)}`)
    }

    return lines
  })

  return [...header, ...events, ''].join('\n')
}

/** Ký tự { } và xuống dòng mang ý nghĩa đặc biệt trong ASS. */
function escapeAssText(text: string): string {
  return text.replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\r?\n/g, '\\N')
}

export function renderSrt(track: SubtitleTrack): string {
  return (
    track.cues
      .map((cue, index) => {
        const text = cue.textSecondary ? `${cue.text}\n${cue.textSecondary}` : cue.text
        return `${index + 1}\n${formatSrtTime(cue.startUs)} --> ${formatSrtTime(cue.endUs)}\n${text}\n`
      })
      .join('\n') + '\n'
  )
}

export async function writeAssFile(
  track: SubtitleTrack,
  videoWidth: number,
  videoHeight: number,
  outputPath: string
): Promise<void> {
  await writeFile(outputPath, renderAss(track, videoWidth, videoHeight), 'utf8')
}

export async function writeSrtFile(track: SubtitleTrack, outputPath: string): Promise<void> {
  await writeFile(outputPath, renderSrt(track), 'utf8')
}
