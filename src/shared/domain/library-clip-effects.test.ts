import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import type { Clip } from './timeline-track-types'
import {
  LIBRARY_MOTION_DRAG_MIME,
  LIBRARY_MOTION_KINDS,
  LIBRARY_TRANSITION_DRAG_MIME,
  LIBRARY_TRANSITION_KINDS,
  libraryDragMime,
  libraryMotionCommands,
  parseLibraryDragPayload
} from './library-clip-effects'
import { findCutPoints, setCutTransitionCommands } from './timeline-cut-transitions'

function clip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
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

describe('thẻ Library', () => {
  it('chuyển cảnh và zoom kéo bằng HAI kiểu dữ liệu khác nhau', () => {
    // Đang rê thì chỉ đọc được kiểu, nên kiểu phải tự nói thẻ là loại gì.
    expect(libraryDragMime({ type: 'transition', kind: 'fade' })).toBe(LIBRARY_TRANSITION_DRAG_MIME)
    expect(libraryDragMime({ type: 'motion', kind: 'shake' })).toBe(LIBRARY_MOTION_DRAG_MIME)
    expect(LIBRARY_TRANSITION_DRAG_MIME).not.toBe(LIBRARY_MOTION_DRAG_MIME)
  })

  it('zoom giữ cường độ người dùng đã chỉnh khi đổi kiểu', () => {
    const planned = libraryMotionCommands(
      'shake',
      clip({ motion: { kind: 'zoom-in', intensity: 0.9 } }),
      'video'
    )
    expect(planned?.commands[0]).toMatchObject({ motion: { kind: 'shake', intensity: 0.9 } })
  })

  it('clip tiếng không nhận zoom', () => {
    // Clip tiếng không vẽ ra hình: đặt vào đó là một thao tác không có tác dụng gì.
    expect(libraryMotionCommands('zoom-in', clip(), 'audio')).toBeNull()
  })

  it('mọi kiểu trong Library đều là lệnh hợp lệ với reducer thật', () => {
    // Danh sách trong Library lệch với schema lệnh là thẻ thả vào báo lỗi.
    const document = createEmptyProject({ name: 'Thử' })
    const track = document.tracks.find((item) => item.kind === 'video')!
    track.clips.push(clip({ id: 'a' }), clip({ id: 'b', startUs: 3_000_000 }))

    for (const kind of LIBRARY_TRANSITION_KINDS) {
      for (const command of setCutTransitionCommands(findCutPoints(track)[0], kind)) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
    for (const kind of LIBRARY_MOTION_KINDS) {
      for (const command of libraryMotionCommands(kind, track.clips[0], 'video')!.commands) {
        expect(applyEditorCommand(document, command).ok).toBe(true)
      }
    }
  })

  it('đọc dữ liệu kéo thả, bỏ qua dữ liệu hỏng hay kiểu lạ', () => {
    expect(parseLibraryDragPayload('{"type":"motion","kind":"shake"}')).toEqual({
      type: 'motion',
      kind: 'shake'
    })
    expect(parseLibraryDragPayload('{"type":"transition","kind":"khong-co"}')).toBeNull()
    expect(parseLibraryDragPayload('không phải json')).toBeNull()
  })
})
