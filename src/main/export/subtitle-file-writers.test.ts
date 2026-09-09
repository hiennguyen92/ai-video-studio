import { describe, expect, it } from 'vitest'
import { renderAss } from './subtitle-file-writers'
import {
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
  type SubtitleTrack
} from '../../shared/domain/subtitle-types'

/**
 * Đọc dòng Style theo ĐÚNG thứ tự trường mà chính file khai báo ở dòng Format,
 * thay vì đếm dấu phẩy bằng tay. Đếm tay thì thêm một trường vào giữa là bài test
 * vẫn xanh trong khi mọi giá trị phía sau đã lệch đi một ô — đúng kiểu hỏng lặng lẽ
 * mà libass không bao giờ báo.
 */
function readAssStyle(ass: string, name: string): Record<string, string> {
  const format = ass
    .split('\n')
    .find((line) => line.startsWith('Format: Name, Fontname'))
    ?.slice('Format:'.length)
    .split(',')
    .map((field) => field.trim())
  if (!format) throw new Error('Không thấy dòng Format của [V4+ Styles]')

  const values = ass
    .split('\n')
    .find((line) => line.startsWith(`Style: ${name},`))
    ?.slice('Style:'.length)
    .split(',')
    .map((value) => value.trim())
  if (!values) throw new Error(`Không thấy dòng Style: ${name}`)

  expect(values).toHaveLength(format.length)
  return Object.fromEntries(format.map((field, index) => [field, values[index]]))
}

function trackWith(style: Partial<SubtitleStyle>): SubtitleTrack {
  return {
    id: 'sub_1',
    name: 'Phụ đề',
    language: 'vi',
    source: { kind: 'manual' },
    style: { ...DEFAULT_SUBTITLE_STYLE, ...style },
    cues: [{ id: 'cue_1', startUs: 0, endUs: 1_500_000, text: 'Xin chào các bạn', edited: false }]
  }
}

describe('renderAss — góc xoay', () => {
  it('đảo dấu góc xoay vì ASS đếm ngược chiều kim đồng hồ', () => {
    // 12° theo chiều kim đồng hồ ở preview = Angle -12 trong ASS.
    const style = readAssStyle(renderAss(trackWith({ rotationDeg: 12 }), 1080, 1920), 'Chinh')
    expect(style.Angle).toBe('-12')
  })

  it('đảo dấu cả chiều ngược lại', () => {
    const style = readAssStyle(renderAss(trackWith({ rotationDeg: -8 }), 1080, 1920), 'Chinh')
    expect(style.Angle).toBe('8')
  })

  it('không xoay khi không đặt góc', () => {
    const style = readAssStyle(renderAss(trackWith({}), 1080, 1920), 'Chinh')
    // "0" chứ không phải "-0": libass đọc được cả hai, nhưng "-0" là dấu hiệu
    // của một phép tính đang trôi chỗ nào đó.
    expect(style.Angle).toBe('0')
  })

  it('dòng phụ đề thứ hai xoay cùng góc với dòng chính', () => {
    const ass = renderAss(trackWith({ rotationDeg: 15 }), 1080, 1920)
    expect(readAssStyle(ass, 'Phu').Angle).toBe('-15')
  })
})

describe('renderAss — kiểu chữ', () => {
  it('dùng tên PostScript khi đã chọn kiểu cụ thể', () => {
    const style = readAssStyle(
      renderAss(
        trackWith({
          fontFamily: 'American Typewriter',
          fontPostScriptName: 'AmericanTypewriter-Bold'
        }),
        1080,
        1920
      ),
      'Chinh'
    )
    expect(style.Fontname).toBe('AmericanTypewriter-Bold')
    // Kiểu đã đậm sẵn; bật thêm cờ Bold là libass làm đậm giả chồng lên.
    expect(style.Bold).toBe('0')
  })

  it('giữ cờ đậm khi chỉ có tên họ', () => {
    const style = readAssStyle(renderAss(trackWith({ bold: true }), 1080, 1920), 'Chinh')
    expect(style.Fontname).toBe('Be Vietnam Pro')
    expect(style.Bold).toBe('-1')
  })
})

describe('renderAss — nền hộp', () => {
  it('BorderStyle 3 khi bật nền hộp, 1 khi tắt', () => {
    expect(
      readAssStyle(renderAss(trackWith({ boxOpacity: 0.75 }), 1080, 1920), 'Chinh').BorderStyle
    ).toBe('3')
    expect(
      readAssStyle(renderAss(trackWith({ boxOpacity: 0 }), 1080, 1920), 'Chinh').BorderStyle
    ).toBe('1')
  })

  it('PlayRes khớp độ phân giải xuất', () => {
    const ass = renderAss(trackWith({}), 1080, 1920)
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
  })
})

describe('renderAss — vị trí tự do', () => {
  function dialogueLines(ass: string): string[] {
    return ass.split('\n').filter((line) => line.startsWith('Dialogue:'))
  }

  it('không ghim thì dòng Dialogue không có thẻ ghi đè nào', () => {
    const [line] = dialogueLines(renderAss(trackWith({}), 1080, 1920))
    expect(line).not.toContain('\\pos')
    expect(line.endsWith('Xin chào các bạn')).toBe(true)
  })

  it('ghim thì thêm \\an5\\pos tính theo PlayRes', () => {
    const ass = renderAss(trackWith({ position: { xPct: 0.25, yPct: 0.8 } }), 1080, 1920)
    // PlayRes bằng đúng độ phân giải xuất, nên 25% của 1080 là 270.
    expect(ass).toContain('PlayResX: 1080')
    expect(dialogueLines(ass)[0]).toContain('{\\an5\\pos(270,1536)}')
  })

  it('thẻ đứng TRƯỚC nội dung, nếu không libass coi nó là chữ', () => {
    const [line] = dialogueLines(
      renderAss(trackWith({ position: { xPct: 0.5, yPct: 0.5 } }), 1000, 1000)
    )
    const body = line.slice(line.indexOf(',,0,0,0,,') + ',,0,0,0,,'.length)
    expect(body).toBe('{\\an5\\pos(500,500)}Xin chào các bạn')
  })

  it('dòng phụ đề thứ hai cũng được ghim theo', () => {
    const track = trackWith({ position: { xPct: 0.5, yPct: 0.5 } })
    track.cues[0].textSecondary = 'Second line'
    const lines = dialogueLines(renderAss(track, 1000, 1000))
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('{\\an5\\pos(500,500)}')
  })
})
