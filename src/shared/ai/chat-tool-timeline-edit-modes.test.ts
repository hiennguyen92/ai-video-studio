import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Clip } from '../domain/timeline-track-types'
import { buildProjectContext } from './chat-context-builder'
import { chatToolDescriptions, chatToolParameterHints } from './chat-tool-catalog'
import { planChatToolCalls } from './chat-tool-planner'

/** Hai clip 10 s nằm liền nhau trên track hình đầu tiên, từ một video 60 s. */
function withTwoClips(): ProjectDocument {
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
  for (const [clipId, startUs] of [
    ['clip_a', 0],
    ['clip_b', 10_000_000]
  ] as const) {
    const result = applyEditorCommand(document, {
      type: 'clip/insert',
      clipId,
      trackId: document.tracks[0].id,
      assetId: 'asset_1',
      startUs,
      durationUs: 10_000_000,
      sourceInUs: 5_000_000
    })
    if (!result.ok) throw new Error(result.error)
  }
  return document
}

function run(
  document: ProjectDocument,
  name: string,
  args: Record<string, unknown>
): ReturnType<typeof planChatToolCalls> {
  const plan = planChatToolCalls(
    { document, selectedClipIds: ['clip_a'], playheadUs: 0, makeId: (prefix) => `${prefix}_1` },
    [{ name, arguments: args }]
  )
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    const applied = applyEditorCommand(document, command)
    if (!applied.ok) throw new Error(applied.error)
  }
  return plan
}

const clip = (document: ProjectDocument, id: string): Clip =>
  document.tracks[0].clips.find((item) => item.id === id)!

describe('công cụ chế độ sửa timeline của agent', () => {
  it('ripple trim cắt mép cuối và kéo clip phía sau lùi theo, không để khe', () => {
    const document = withTwoClips()
    expect(run(document, 'ripple_trim_clip', { edge: 'end', toSeconds: 6 }).failures).toEqual([])
    expect(clip(document, 'clip_a').durationUs).toBe(6_000_000)
    expect(clip(document, 'clip_b').startUs).toBe(6_000_000)
  })

  it('slip đổi đoạn nguồn, giữ chỗ và độ dài; bị kẹp trong file', () => {
    const document = withTwoClips()
    expect(run(document, 'slip_clip', { sourceInSeconds: 20 }).failures).toEqual([])
    expect(clip(document, 'clip_a')).toMatchObject({
      sourceInUs: 20_000_000,
      startUs: 0,
      durationUs: 10_000_000
    })

    run(document, 'slip_clip', { clipId: 'clip_a', sourceInSeconds: 58 })
    expect(clip(document, 'clip_a').sourceInUs).toBe(50_000_000)
  })

  it('rate stretch kéo dài clip thì chậm lại, giữ nguyên đoạn nguồn', () => {
    const document = withTwoClips()
    expect(
      run(document, 'rate_stretch_clip', { clipId: 'clip_b', edge: 'end', toSeconds: 30 }).failures
    ).toEqual([])
    expect(clip(document, 'clip_b')).toMatchObject({ speed: 0.5, durationUs: 20_000_000 })
  })

  it('slip và rate stretch từ chối clip không nằm trên track hình/tiếng', () => {
    const document = withTwoClips()
    document.tracks[0].kind = 'image'
    const slip = run(document, 'slip_clip', { sourceInSeconds: 1 })
    expect(slip.steps).toEqual([])
    expect(slip.failures[0].reason).toContain('clip hình hoặc clip tiếng')
    const stretch = run(document, 'rate_stretch_clip', { edge: 'end', toSeconds: 12 })
    expect(stretch.failures[0].reason).toContain('clip hình hoặc clip tiếng')
  })

  it('tổng quan in đoạn nguồn, tốc độ, fade, Adjust, filter, zoom của clip', () => {
    const document = withTwoClips()
    run(document, 'set_clip_speed', { speed: 2 })
    run(document, 'set_clip_fade', { fadeInSeconds: 0.5 })
    run(document, 'set_clip_adjust', { brightness: 1.2 })
    run(document, 'set_clip_filter', { filterId: 'teal-orange', intensity: 0.5 })
    run(document, 'set_clip_zoom', { kind: 'zoom-in', intensity: 0.8 })

    const overview = buildProjectContext({ document, selectedClipIds: [], playheadUs: 0 })
    const line = overview.split('\n').find((item) => item.startsWith('- id=clip_a'))!
    expect(line).toContain('source=5.00–15.00s')
    expect(line).toContain('speed=2')
    expect(line).toContain('fadeIn=0.50s')
    expect(line).toContain('adjust=[brightness=1.2]')
    expect(line).toContain('filter=teal-orange@0.5')
    expect(line).toContain('zoom=zoom-in@0.8')
    expect(line).not.toContain('look')
    expect(overview).toContain('Filters (use set_clip_filter with the id):')
  })

  it('mỗi công cụ mới có mô tả và gợi ý tham số', () => {
    for (const tool of ['ripple_trim_clip', 'slip_clip', 'rate_stretch_clip'] as const) {
      expect(chatToolDescriptions[tool].length).toBeGreaterThan(40)
      expect(chatToolParameterHints[tool]).toContain('clipId')
    }
  })
})
