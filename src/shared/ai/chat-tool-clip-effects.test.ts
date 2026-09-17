import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Clip } from '../domain/timeline-track-types'
import { chatToolDescriptions, chatToolParameterHints } from './chat-tool-catalog'
import { buildProjectContext } from './chat-context-builder'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

function withClip(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'a.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true, width: 640, height: 360 },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  } as never)
  const result = applyEditorCommand(document, {
    type: 'clip/insert',
    clipId: 'clip_a',
    trackId: document.tracks[0].id,
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0
  })
  if (!result.ok) throw new Error(result.error)
  return document
}

let counter = 0
const context = (document: ProjectDocument): ChatEditContext => ({
  document,
  selectedClipIds: ['clip_a'],
  playheadUs: 0,
  makeId: (prefix) => `${prefix ?? 'clip'}_${(counter += 1)}`
})

function run(
  document: ProjectDocument,
  name: string,
  args: Record<string, unknown>
): ReturnType<typeof planChatToolCalls> {
  const plan = planChatToolCalls(context(document), [{ name, arguments: args }])
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    expect(applyEditorCommand(document, command).ok).toBe(true)
  }
  return plan
}

describe('công cụ effect của agent', () => {
  it('thêm, chỉnh, gỡ một effect; id mới có trong mô tả và tổng quan', () => {
    const document = withClip()
    const clip = (): Clip => document.tracks[0].clips[0]

    const added = run(document, 'add_clip_effect', {
      kind: 'duotone',
      params: { shadowColor: '#112233' }
    })
    expect(added.failures).toEqual([])
    const effectId = clip().effects![0].id
    expect(effectId).toMatch(/^fx_/)
    expect(added.steps[0].description).toContain(effectId)
    expect(clip().effects![0].params.shadowColor).toBe('#112233')

    const overview = buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })
    expect(overview).toContain(`effects=[${effectId}:duotone@0.7`)

    expect(run(document, 'update_clip_effect', { effectId, intensity: 0.2 }).failures).toEqual([])
    expect(clip().effects![0].intensity).toBe(0.2)

    expect(run(document, 'remove_clip_effect', { effectId }).failures).toEqual([])
    expect(clip().effects).toBeUndefined()
  })

  it('gỡ hết khi không nêu effectId', () => {
    const document = withClip()
    run(document, 'add_clip_effect', { kind: 'sepia' })
    run(document, 'add_clip_effect', { kind: 'vignette' })
    run(document, 'remove_clip_effect', {})
    expect(document.tracks[0].clips[0].effects).toBeUndefined()
  })

  it('dời effect lên/xuống trong chồng; chạm đầu/cuối hoặc id lạ thì báo lỗi', () => {
    const document = withClip()
    run(document, 'add_clip_effect', { kind: 'sepia' })
    run(document, 'add_clip_effect', { kind: 'vignette' })
    const kinds = (): string[] => document.tracks[0].clips[0].effects!.map((item) => item.kind)
    const [sepiaId, vignetteId] = document.tracks[0].clips[0].effects!.map((item) => item.id)

    expect(
      run(document, 'move_clip_effect', { effectId: vignetteId, direction: 'up' }).failures
    ).toEqual([])
    expect(kinds()).toEqual(['vignette', 'sepia'])

    const atEnd = run(document, 'move_clip_effect', { effectId: sepiaId, direction: 'down' })
    expect(atEnd.failures[0].reason).toContain('cuối')
    const unknown = run(document, 'move_clip_effect', { effectId: 'fx_nope', direction: 'up' })
    expect(unknown.failures[0].reason).toContain(sepiaId)
    expect(kinds()).toEqual(['vignette', 'sepia'])
  })

  it('kind bịa, thông số bịa, id bịa đều bị chặn kèm gợi ý sửa', () => {
    const document = withClip()
    const badKind = run(document, 'add_clip_effect', { kind: 'hologram' })
    expect(badKind.steps).toEqual([])
    expect(badKind.failures[0].reason).toContain('film-grain')

    const badParam = run(document, 'add_clip_effect', { kind: 'magnifier', params: { power: 3 } })
    expect(badParam.failures[0].reason).toContain('zoom')

    const badId = run(document, 'update_clip_effect', { effectId: 'fx_nope', intensity: 1 })
    expect(badId.failures[0].reason).toContain('không có')
    expect(document.tracks[0].clips[0].effects).toBeUndefined()
  })

  it('tổng quan liệt kê danh mục effect kèm khoảng thông số; công cụ có mô tả', () => {
    const overview = buildProjectContext({
      document: withClip(),
      selectedClipIds: [],
      playheadUs: 0
    })
    expect(overview).toContain(
      'kind=magnifier "Magnifier" (distort) params: x 0..100% (default 50)'
    )
    expect(overview).toContain('kind=vignette "Vignette" (stylize) params: intensity 0..1')
    for (const tool of [
      'add_clip_effect',
      'update_clip_effect',
      'remove_clip_effect',
      'move_clip_effect'
    ] as const) {
      expect(chatToolDescriptions[tool].length).toBeGreaterThan(20)
      expect(chatToolParameterHints[tool]).toContain('clipId')
    }
  })
})
