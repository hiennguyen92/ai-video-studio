import { describe, expect, it } from 'vitest'
import { junctionShortfall, trackTransitionFrames } from './cut-transition-fit'
import { DEFAULT_TRANSITION_DURATION_US, type Clip } from './timeline-track-types'

/**
 * Hai mép của MỘT chỗ nối phải dùng chung một số khung.
 *
 * Mỗi mép tự kẹp lấy phần mình là chỗ nối hổng: clip đi chạy trọn hiệu ứng ra và
 * trượt khỏi khung, clip đến không đủ nguồn để lấn nên chưa xuất hiện, và giữa hai
 * clip là một mảng nền trống chiếm quá nửa khung hình.
 */

const FPS = { num: 30, den: 1 }
/** 0,5 giây ở 30 khung/giây. */
const FULL = 15

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip',
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 3_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...overrides
  }
}

const transition = { kind: 'fade' as const, durationUs: DEFAULT_TRANSITION_DURATION_US }

/** Chỗ nối ở giây 3: clip trái có hiệu ứng ra, clip phải có hiệu ứng vào. */
function junction(rightSourceInUs: number): Clip[] {
  return [
    clip({ id: 'trai', transitionOut: transition }),
    clip({
      id: 'phai',
      startUs: 3_000_000,
      sourceInUs: rightSourceInUs,
      transitionIn: transition
    })
  ]
}

describe('kẹp chung hai mép của một chỗ nối', () => {
  it('clip sau chưa cắt đầu thì CẢ HAI mép cùng về 0', () => {
    // Đây là chỗ nối phổ biến nhất: hai clip vừa nhập, đặt liền nhau. Trước đây
    // clip đi vẫn chạy trọn hiệu ứng ra và để lộ nền trống quá nửa khung hình.
    const { enter, exit } = trackTransitionFrames(junction(0), FPS)
    expect(enter.get('phai')).toBe(0)
    expect(exit.get('trai')).toBe(0)
  })

  it('còn ít nguồn thì hai mép cùng ngắn lại, không mất hẳn', () => {
    // 0,2 giây nguồn phía trước = 6 khung. Ngắn nhưng kín khung.
    const { enter, exit } = trackTransitionFrames(junction(200_000), FPS)
    expect(enter.get('phai')).toBe(6)
    expect(exit.get('trai')).toBe(6)
  })

  it('đủ nguồn thì chạy trọn thời lượng người dùng đặt', () => {
    const { enter, exit } = trackTransitionFrames(junction(2_000_000), FPS)
    expect(enter.get('phai')).toBe(FULL)
    expect(exit.get('trai')).toBe(FULL)
  })

  it('ảnh tĩnh không cần nguồn phía trước nên không bị kẹp', () => {
    // Một tấm ảnh đứng yên: lấy bao nhiêu khung phía trước cũng được.
    const { enter, exit } = trackTransitionFrames(junction(0), FPS, true)
    expect(enter.get('phai')).toBe(FULL)
    expect(exit.get('trai')).toBe(FULL)
  })

  it('mép lẻ KHÔNG bị kẹp theo hàng xóm', () => {
    // Clip sau không có hiệu ứng vào thì đây không phải chuyển cảnh của chỗ nối:
    // mờ vào nền là thứ người dùng đã đặt riêng cho clip trước, không phải lỗi.
    const clips = [
      clip({ id: 'trai', transitionOut: transition }),
      clip({ id: 'phai', startUs: 3_000_000, sourceInUs: 0 })
    ]
    expect(trackTransitionFrames(clips, FPS).exit.get('trai')).toBe(FULL)
  })

  it('clip cuối timeline vẫn mờ ra được: không có ai phía sau để kẹp', () => {
    const clips = [clip({ id: 'mot', transitionOut: transition })]
    expect(trackTransitionFrames(clips, FPS).exit.get('mot')).toBe(FULL)
  })

  it('hai clip rời nhau không phải chỗ nối', () => {
    const clips = [
      clip({ id: 'trai', transitionOut: transition }),
      clip({ id: 'phai', startUs: 9_000_000, sourceInUs: 0, transitionIn: transition })
    ]
    const { enter, exit } = trackTransitionFrames(clips, FPS)
    expect(exit.get('trai')).toBe(FULL)
    expect(enter.get('phai')).toBe(0)
  })

  it('hai hiệu ứng không chiếm trọn một clip ngắn', () => {
    // Clip 0,4 giây = 12 khung, cộng phần lấn 12 khung là 24; mép ra nhiều nhất 12.
    const clips = [
      clip({ id: 'trai', durationUs: 3_000_000, transitionOut: transition }),
      clip({
        id: 'giua',
        startUs: 3_000_000,
        durationUs: 400_000,
        sourceInUs: 2_000_000,
        transitionIn: transition,
        transitionOut: transition
      }),
      clip({ id: 'phai', startUs: 3_400_000, sourceInUs: 2_000_000, transitionIn: transition })
    ]
    const { enter, exit } = trackTransitionFrames(clips, FPS)
    expect(enter.get('giua')).toBe(12)
    expect(exit.get('giua')).toBe(12)
    // Chỗ nối thứ hai lấy theo mép ngắn hơn, nên clip phải cũng chỉ vào 12 khung.
    expect(enter.get('phai')).toBe(12)
  })
})

describe('junctionShortfall — số để giao diện nói ra', () => {
  it('báo đúng phần bị cắt ngắn', () => {
    const [left, right] = junction(200_000)
    expect(junctionShortfall(left, right, FPS)).toEqual({ wantedFrames: FULL, frames: 6 })
  })

  it('chạy đủ thì số thật bằng số người dùng đặt', () => {
    const [left, right] = junction(2_000_000)
    expect(junctionShortfall(left, right, FPS)).toEqual({ wantedFrames: FULL, frames: FULL })
  })
})
