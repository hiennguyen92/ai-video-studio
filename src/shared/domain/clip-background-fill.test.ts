import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { sanitizeClipForPaste } from '../commands/clip-paste-sanitize'
import { planChatToolCalls } from '../ai/chat-tool-planner'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import { buildRenderPlan, requiresRemotionRenderer } from './remotion-render-plan'

let counter = 0
const makeId = (prefix = 'clip'): string => `${prefix}_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử', aspectRatio: '9:16' })
  document.assets.push({
    id: 'cam',
    kind: 'video',
    name: 'ngang.mp4',
    source: { path: '/tmp/ngang.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: false, width: 1920, height: 1080 },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  } as ProjectDocument['assets'][number])
  for (const [clipId, startUs] of [
    ['a', 0],
    ['b', 5_000_000]
  ] as const) {
    applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[0].id,
      assetId: 'cam',
      startUs,
      durationUs: 5_000_000,
      sourceInUs: 0
    })
  }
  return document
}

describe('nền mờ phía sau clip', () => {
  it('đặt, đổi mức rồi bỏ; bỏ là xoá hẳn khoá chứ không lưu null', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'clip/update',
      clipId: 'a',
      patch: { backgroundFill: { kind: 'blur', amount: 0.7 } }
    })
    expect(document.tracks[0].clips[0].backgroundFill).toEqual({ kind: 'blur', amount: 0.7 })

    applyEditorCommand(document, {
      type: 'clip/update',
      clipId: 'a',
      patch: { backgroundFill: null }
    })
    expect('backgroundFill' in document.tracks[0].clips[0]).toBe(false)
  })

  it('đi vào kế hoạch vẽ và buộc xuất bằng Remotion', () => {
    const document = project()
    expect(requiresRemotionRenderer(document)).toBe(false)
    applyEditorCommand(document, {
      type: 'clip/update',
      clipId: 'a',
      patch: { backgroundFill: { kind: 'blur', amount: 0.4 } }
    })
    expect(requiresRemotionRenderer(document)).toBe(true)
    expect(buildRenderPlan(document).video[0].backgroundFill).toEqual({ kind: 'blur', amount: 0.4 })
  })

  it('chép dán giữ nền mờ, kẹp mức về 0..1', () => {
    const document = project()
    const pasted = sanitizeClipForPaste(
      { ...document.tracks[0].clips[0], backgroundFill: { kind: 'blur', amount: 9 } },
      { id: 'moi', startUs: 0 }
    )
    expect(pasted?.backgroundFill).toEqual({ kind: 'blur', amount: 1 })
  })

  it('agent áp cho mọi clip hình trong một bước', () => {
    const document = project()
    const plan = planChatToolCalls({ document, selectedClipIds: [], playheadUs: 0, makeId }, [
      { name: 'set_background_fill', arguments: { all: true, kind: 'blur', amount: 0.6 } }
    ])
    expect(plan.failures).toEqual([])
    expect(plan.steps).toHaveLength(1)
    for (const command of plan.steps[0].commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[0].clips.map((clip) => clip.backgroundFill?.amount)).toEqual([0.6, 0.6])
  })
})
