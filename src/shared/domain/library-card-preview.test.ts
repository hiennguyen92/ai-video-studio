import { describe, expect, it } from 'vitest'
import { transitionStyleAt } from './clip-transition-style'
import {
  MOTION_PREVIEW_CYCLE_MS,
  TRANSITION_PREVIEW_CYCLE_MS,
  libraryCardFrameAt,
  libraryCardRestingFrame
} from './library-card-preview'
import { LIBRARY_MOTION_KINDS, LIBRARY_TRANSITION_KINDS } from './library-clip-effects'

describe('minh hoạ thẻ Library', () => {
  it('chuyển cảnh: đầu vòng chưa hiện cảnh B, cuối vòng đã hiện hẳn', () => {
    const fade = { type: 'transition', kind: 'fade' } as const
    expect(libraryCardFrameAt(fade, 0).incoming?.opacity).toBe(0)
    expect(libraryCardFrameAt(fade, TRANSITION_PREVIEW_CYCLE_MS - 1).incoming?.opacity).toBe(1)
  })

  it('lặp lại theo vòng, không dừng ở khung cuối', () => {
    const fade = { type: 'transition', kind: 'fade' } as const
    expect(libraryCardFrameAt(fade, TRANSITION_PREVIEW_CYCLE_MS * 3)).toEqual(
      libraryCardFrameAt(fade, 0)
    )
  })

  it('dùng đúng hàm chuyển cảnh của bản xuất, không vẽ lại bản riêng', () => {
    // Minh hoạ lệch với video thật là thẻ hứa một thứ mà clip không làm.
    const middle = libraryCardRestingFrame({ type: 'transition', kind: 'wipe-left' })
    expect(middle.incoming).toEqual(transitionStyleAt('wipe-left', 0.5, 16))
  })

  it('mọi kiểu đều ra được khung hình', () => {
    for (const kind of LIBRARY_TRANSITION_KINDS) {
      expect(libraryCardRestingFrame({ type: 'transition', kind }).incoming).toBeDefined()
    }
    for (const kind of LIBRARY_MOTION_KINDS) {
      // Ở khung đứng yên, chuyển động nào cũng phải đang lệch khỏi trạng thái gốc —
      // không thì thẻ trông như "Đứng yên".
      expect(libraryCardRestingFrame({ type: 'motion', kind }).motionTransform).not.toBe('')
    }
  })

  it('thẻ nào ở khung nghỉ cũng đang giữa chừng, không thẻ nào trông như đã xong', () => {
    // Cả lưới đứng ở khung cuối thì hai mươi lăm thẻ giống hệt nhau.
    for (const kind of LIBRARY_TRANSITION_KINDS) {
      const resting = libraryCardRestingFrame({ type: 'transition', kind }).incoming
      expect(resting, kind).not.toEqual({ opacity: 1 })
    }
  })

  it('chuyển động đổi theo thời gian trong một vòng', () => {
    const zoom = { type: 'motion', kind: 'zoom-in' } as const
    expect(libraryCardFrameAt(zoom, 0).motionTransform).not.toBe(
      libraryCardFrameAt(zoom, MOTION_PREVIEW_CYCLE_MS * 0.9).motionTransform
    )
  })
})
