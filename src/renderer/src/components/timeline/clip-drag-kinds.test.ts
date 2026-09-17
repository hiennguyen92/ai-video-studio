import { describe, expect, it } from 'vitest'
import type { Clip } from '../../../../shared/domain/timeline-track-types'
import { clipDragCommands, clipDragKind, ratePreview, slipPreview } from './clip-drag-kinds'

const clip: Clip = {
  id: 'c',
  assetId: 'a',
  startUs: 1_000_000,
  durationUs: 2_000_000,
  sourceInUs: 4_000_000,
  speed: 1,
  volume: 1,
  fadeInUs: 0,
  fadeOutUs: 0
}

describe('chế độ công cụ quyết định kiểu kéo', () => {
  it('Selection giữ nguyên hành vi cũ', () => {
    expect(clipDragKind('select', 'move', 'video')).toBe('move')
    expect(clipDragKind('select', 'trim-end', 'image')).toBe('trim-end')
  })

  it('Trim: mép là ripple, thân chỉ chọn', () => {
    expect(clipDragKind('trim', 'trim-start', 'audio')).toBe('ripple-start')
    expect(clipDragKind('trim', 'move', 'video')).toBe('none')
  })

  it('Slip và Rate stretch không áp cho ảnh tĩnh; Blade không kéo', () => {
    expect(clipDragKind('slip', 'move', 'video')).toBe('slip')
    expect(clipDragKind('slip', 'trim-end', 'image')).toBe('none')
    expect(clipDragKind('rate-stretch', 'trim-end', 'video')).toBe('rate-end')
    expect(clipDragKind('rate-stretch', 'move', 'video')).toBe('none')
    expect(clipDragKind('rate-stretch', 'trim-end', 'image')).toBe('none')
    expect(clipDragKind('blade', 'move', 'video')).toBe('none')
  })
})

describe('bản xem trước và lệnh ghi', () => {
  it('rate stretch hiện tốc độ mới và ghi clip/rate-stretch', () => {
    const rate = ratePreview(clip, 'rate-end', 5_000_000, 1000)!
    expect(rate).toMatchObject({ durationUs: 4_000_000, speed: 0.5, badge: '0.50×' })
    const commands = clipDragCommands(clip, 't', {
      clipId: 'c',
      kind: 'rate-end',
      targetTrackId: 't',
      snappedToUs: null,
      ...rate
    })
    expect(commands).toEqual([
      { type: 'clip/rate-stretch', clipId: 'c', edge: 'end', toUs: 5_000_000 }
    ])
  })

  it('slip hiện điểm vào mới; kéo không đổi gì thì không ghi lệnh', () => {
    const slip = slipPreview(clip, 1_000_000, 20_000_000)
    expect(slip.sourceInUs).toBe(3_000_000)
    const base = {
      clipId: 'c',
      kind: 'slip' as const,
      targetTrackId: 't',
      startUs: 1_000_000,
      durationUs: 2_000_000,
      snappedToUs: null
    }
    expect(clipDragCommands(clip, 't', { ...base, ...slip })).toEqual([
      { type: 'clip/slip', clipId: 'c', toSourceInUs: 3_000_000 }
    ])
    expect(clipDragCommands(clip, 't', { ...base, sourceInUs: 4_000_000 })).toEqual([])
  })

  it('ripple trim ghi clip/ripple-trim với mép mới', () => {
    expect(
      clipDragCommands(clip, 't', {
        clipId: 'c',
        kind: 'ripple-end',
        targetTrackId: 't',
        startUs: 1_000_000,
        durationUs: 1_500_000,
        snappedToUs: null
      })
    ).toEqual([{ type: 'clip/ripple-trim', clipId: 'c', edge: 'end', toUs: 2_500_000 }])
  })
})
