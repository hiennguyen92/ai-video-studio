import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import type { EditorCommand } from '../commands/editor-command-types'
import {
  addClipEffectCommands,
  MAX_CLIP_EFFECTS,
  moveClipEffectCommands,
  removeClipEffectCommands,
  updateClipEffectCommands
} from './clip-effect-commands'
import { createEmptyProject } from './project-document-factory'
import { buildRenderPlan, requiresRemotionRenderer } from './remotion-render-plan'
import type { Clip } from './timeline-track-types'

function projectWithClip(kind: 'video' | 'audio'): ReturnType<typeof createEmptyProject> {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: kind === 'audio' ? 'audio' : 'video',
    name: 'a',
    source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: {
      durationUs: 5_000_000,
      hasVideo: kind === 'video',
      hasAudio: true,
      width: 640,
      height: 360
    },
    derived: {},
    origin: 'imported',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  } as never)
  document.tracks
    .find((item) => item.kind === kind)!
    .clips.push({
      id: 'clip_1',
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 5_000_000,
      sourceInUs: 0,
      speed: 1,
      volume: 1,
      fadeInUs: 0,
      fadeOutUs: 0
    })
  return document
}

describe('chồng effect qua lệnh', () => {
  const document = projectWithClip('video')
  const clip = (): Clip => document.tracks.find((item) => item.kind === 'video')!.clips[0]
  const apply = (planned: { commands: EditorCommand[] } | null): void => {
    expect(planned).not.toBeNull()
    for (const command of planned!.commands)
      expect(applyEditorCommand(document, command).ok).toBe(true)
  }

  it('thêm nối đuôi, cùng loại chồng được hai lần', () => {
    apply(addClipEffectCommands(clip(), 'vignette', 'fx_1'))
    apply(addClipEffectCommands(clip(), 'film-grain', 'fx_2', { intensity: 0.3 }))
    apply(addClipEffectCommands(clip(), 'vignette', 'fx_3'))
    expect(clip().effects!.map((effect) => effect.id)).toEqual(['fx_1', 'fx_2', 'fx_3'])
    expect(clip().effects![1].intensity).toBe(0.3)
  })

  it('sửa thông số được kẹp, thông số khác giữ nguyên', () => {
    apply(addClipEffectCommands(clip(), 'magnifier', 'fx_4', { params: { zoom: 3 } }))
    apply(updateClipEffectCommands(clip(), 'fx_4', { params: { radius: 999 } }))
    expect(clip().effects![3].params).toMatchObject({ zoom: 3, radius: 50, x: 50 })
  })

  it('đổi thứ tự, chạm đầu thì không làm gì', () => {
    expect(moveClipEffectCommands(clip(), 'fx_1', -1)).toBeNull()
    apply(moveClipEffectCommands(clip(), 'fx_1', 1))
    expect(clip().effects!.map((effect) => effect.id)).toEqual(['fx_2', 'fx_1', 'fx_3', 'fx_4'])
  })

  it('gỡ từng cái; gỡ hết thì trường biến mất', () => {
    for (const id of ['fx_1', 'fx_2', 'fx_3', 'fx_4']) apply(removeClipEffectCommands(clip(), id))
    expect(clip().effects).toBeUndefined()
    expect(removeClipEffectCommands(clip(), 'fx_1')).toBeNull()
  })

  it('kind lạ và chồng đầy thì không có lệnh', () => {
    expect(addClipEffectCommands(clip(), 'khong-co', 'x')).toBeNull()
    const full = {
      ...clip(),
      effects: Array.from({ length: MAX_CLIP_EFFECTS }, (_, index) => ({
        id: `f${index}`,
        kind: 'sepia',
        intensity: 1,
        params: {}
      }))
    }
    expect(addClipEffectCommands(full, 'sepia', 'x')).toBeNull()
  })

  it('clip tiếng không nhận effect', () => {
    const audio = projectWithClip('audio')
    expect(
      applyEditorCommand(audio, {
        type: 'clip/set-effects',
        clipId: 'clip_1',
        effects: [{ id: 'fx', kind: 'sepia', intensity: 1, params: {} }]
      }).ok
    ).toBe(false)
  })
})

describe('effect trong kế hoạch dựng hình', () => {
  it('kind lạ bị bỏ, thông số và cường độ được kẹp, buộc xuất bằng Remotion', () => {
    const document = projectWithClip('video')
    expect(requiresRemotionRenderer(document)).toBe(false)
    document.tracks.find((item) => item.kind === 'video')!.clips[0].effects = [
      { id: 'a', kind: 'effect-tu-ban-moi', intensity: 1, params: {} },
      { id: 'b', kind: 'pixelate', intensity: 5, params: { junk: 1 } },
      { id: 'c', kind: 'circle-mask', intensity: 0.2, params: { radius: -4 } }
    ]
    expect(requiresRemotionRenderer(document)).toBe(true)
    expect(buildRenderPlan(document).video[0].effects).toEqual([
      { id: 'b', kind: 'pixelate', intensity: 1, params: {} },
      { id: 'c', kind: 'circle-mask', intensity: 0.2, params: { x: 50, y: 50, radius: 5 } }
    ])
  })

  it('toàn kind lạ thì không có effect trong kế hoạch', () => {
    const document = projectWithClip('video')
    document.tracks.find((item) => item.kind === 'video')!.clips[0].effects = [
      { id: 'a', kind: 'khong-co', intensity: 1, params: {} }
    ]
    expect(buildRenderPlan(document).video[0].effects).toBeUndefined()
  })
})
