import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { Clip, Track } from './timeline-track-types'
import {
  CUT_TRANSITION_DURATIONS_US,
  cutTransitionDurationUs,
  setCutTransitionDurationCommands,
  findCutPoints,
  isJunction,
  nearestJunction,
  removeCutTransitionCommands,
  setCutTransitionCommands
} from './timeline-cut-transitions'

function clip(id: string, startUs: number, overrides: Partial<Clip> = {}): Clip {
  return {
    id,
    assetId: 'asset_1',
    startUs,
    durationUs: 2_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    ...overrides
  }
}

function track(clips: Clip[]): Track {
  const document = createEmptyProject({ name: 'Thử' })
  const video = document.tracks.find((item) => item.kind === 'video')!
  video.clips = clips
  return video
}

describe('chuyển cảnh ở chỗ nối', () => {
  it('chỉ hai clip liền nhau mới tạo chỗ nối, clip có khe hở thì không', () => {
    const points = findCutPoints(track([clip('a', 0), clip('b', 2_000_000), clip('c', 6_000_000)]))
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ atUs: 2_000_000 })
    expect(points[0].leftClip?.id).toBe('a')
    expect(points[0].rightClip?.id).toBe('b')
  })

  it('nhận ra chỗ nối dù clip không xếp theo thứ tự trong mảng', () => {
    expect(findCutPoints(track([clip('b', 2_000_000), clip('a', 0)]))).toHaveLength(1)
  })

  it('đặt chuyển cảnh: ra ở clip trước, vào ở clip sau, cùng một kiểu', () => {
    const [point] = findCutPoints(track([clip('a', 0), clip('b', 2_000_000)]))
    expect(setCutTransitionCommands(point, 'whip-left')).toEqual([
      {
        type: 'clip/set-transition',
        clipId: 'a',
        edge: 'out',
        transition: { kind: 'whip-left', durationUs: 500_000 }
      },
      {
        type: 'clip/set-transition',
        clipId: 'b',
        edge: 'in',
        transition: { kind: 'whip-left', durationUs: 500_000 }
      }
    ])
  })

  it('lệnh áp được qua reducer thật, và gỡ thì xoá cả hai phía', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const video = document.tracks.find((item) => item.kind === 'video')!
    video.clips = [clip('a', 0), clip('b', 2_000_000)]

    for (const command of setCutTransitionCommands(findCutPoints(video)[0], 'spin')) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    const withTransition = findCutPoints(video)[0]
    expect(withTransition.kind).toBe('spin')

    for (const command of removeCutTransitionCommands(withTransition)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(video.clips[0].transitionOut).toBeUndefined()
    expect(video.clips[1].transitionIn).toBeUndefined()
    expect(findCutPoints(video)[0].kind).toBeUndefined()
  })

  it('mép lẻ mang chuyển cảnh từ dự án cũ vẫn hiện ra để gỡ được, nhưng không nhận thả', () => {
    const points = findCutPoints(
      track([clip('a', 0, { transitionOut: { kind: 'fade', durationUs: 500_000 } })])
    )
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ atUs: 2_000_000, kind: 'fade' })
    expect(isJunction(points[0])).toBe(false)
    expect(nearestJunction(points, 2_000_000, 1_000_000)).toBeNull()
    expect(removeCutTransitionCommands(points[0])).toHaveLength(1)
  })

  it('thả gần chỗ nối nào thì nhận chỗ đó, xa quá thì không nhận', () => {
    const points = findCutPoints(track([clip('a', 0), clip('b', 2_000_000), clip('c', 4_000_000)]))
    expect(nearestJunction(points, 3_800_000, 500_000)?.atUs).toBe(4_000_000)
    expect(nearestJunction(points, 3_000_000, 500_000)).toBeNull()
  })

  it('đổi thời lượng: cùng một con số cho cả hai phía, giữ nguyên kiểu', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const video = document.tracks.find((item) => item.kind === 'video')!
    video.clips = [clip('a', 0), clip('b', 2_000_000)]
    for (const command of setCutTransitionCommands(findCutPoints(video)[0], 'blur')) {
      applyEditorCommand(document, command)
    }

    for (const command of setCutTransitionDurationCommands(findCutPoints(video)[0], 1_000_000)) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(video.clips[0].transitionOut).toEqual({ kind: 'blur', durationUs: 1_000_000 })
    expect(video.clips[1].transitionIn).toEqual({ kind: 'blur', durationUs: 1_000_000 })
    expect(cutTransitionDurationUs(findCutPoints(video)[0])).toBe(1_000_000)
  })

  it('chỗ nối chưa có chuyển cảnh thì đổi thời lượng không làm gì', () => {
    const [point] = findCutPoints(track([clip('a', 0), clip('b', 2_000_000)]))
    expect(setCutTransitionDurationCommands(point, 1_000_000)).toEqual([])
  })

  it('mọi mức trong menu đều là thời lượng hợp lệ với reducer', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const video = document.tracks.find((item) => item.kind === 'video')!
    video.clips = [clip('a', 0), clip('b', 2_000_000)]
    for (const command of setCutTransitionCommands(findCutPoints(video)[0], 'fade')) {
      applyEditorCommand(document, command)
    }
    for (const durationUs of CUT_TRANSITION_DURATIONS_US) {
      for (const command of setCutTransitionDurationCommands(findCutPoints(video)[0], durationUs)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
  })
})
