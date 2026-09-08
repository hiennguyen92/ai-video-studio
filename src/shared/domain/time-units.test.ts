import { describe, expect, it } from 'vitest'
import {
  FRAME_RATE_PRESETS,
  formatClockTime,
  formatTimecode,
  frameOfMicros,
  microsOfFrame,
  parseTimecode,
  snapMicrosToFrame
} from './time-units'

const FPS_30 = FRAME_RATE_PRESETS['30']
const FPS_2997 = FRAME_RATE_PRESETS['29.97']
const FPS_2398 = FRAME_RATE_PRESETS['23.976']

describe('chuyển đổi frame <-> microgiây', () => {
  it('khớp chính xác với fps số nguyên', () => {
    expect(microsOfFrame(0, FPS_30)).toBe(0)
    expect(microsOfFrame(30, FPS_30)).toBe(1_000_000)
    expect(frameOfMicros(1_000_000, FPS_30)).toBe(30)
  })

  it('không trôi với fps phân số qua nhiều giờ', () => {
    // 29.97 fps: 107_892 frame ~ 1 giờ. Đi vòng qua µs rồi quay lại phải giữ nguyên.
    for (const frame of [1, 999, 107_892, 215_784]) {
      expect(frameOfMicros(microsOfFrame(frame, FPS_2997), FPS_2997)).toBe(frame)
      expect(frameOfMicros(microsOfFrame(frame, FPS_2398), FPS_2398)).toBe(frame)
    }
  })

  it('làm tròn nửa lên tại đúng điểm giữa frame', () => {
    // 25 fps: một frame = 40_000µs, nên nửa frame rơi đúng vào 20_000µs —
    // đây là trường hợp hoà duy nhất kiểm chứng được bằng số nguyên.
    const FPS_25 = FRAME_RATE_PRESETS['25']
    expect(frameOfMicros(20_000, FPS_25)).toBe(1)
    expect(frameOfMicros(19_999, FPS_25)).toBe(0)
  })

  it('snap là phép luỹ đẳng', () => {
    const snapped = snapMicrosToFrame(1_234_567, FPS_2997)
    expect(snapMicrosToFrame(snapped, FPS_2997)).toBe(snapped)
  })
})

describe('timecode', () => {
  it('hiển thị HH:MM:SS:FF', () => {
    expect(formatTimecode(0, FPS_30)).toBe('00:00:00:00')
    expect(formatTimecode(microsOfFrame(1, FPS_30), FPS_30)).toBe('00:00:00:01')
    expect(formatTimecode(61_000_000, FPS_30)).toBe('00:01:01:00')
    expect(formatTimecode(3_661_000_000, FPS_30)).toBe('01:01:01:00')
  })

  it('phân tích rồi hiển thị lại cho ra chuỗi ban đầu', () => {
    for (const text of ['00:00:00:00', '00:00:05:12', '01:23:45:29']) {
      const us = parseTimecode(text, FPS_30)
      expect(us).not.toBeNull()
      expect(formatTimecode(us as number, FPS_30)).toBe(text)
    }
  })

  it('từ chối số frame vượt quá fps', () => {
    expect(parseTimecode('00:00:01:30', FPS_30)).toBeNull()
    expect(parseTimecode('không phải timecode', FPS_30)).toBeNull()
  })

  it('hiển thị đồng hồ kèm mili giây cho phụ đề', () => {
    expect(formatClockTime(3_661_500_000)).toBe('01:01:01.500')
    expect(formatClockTime(3_661_500_000, false)).toBe('01:01:01')
  })
})
