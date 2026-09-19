import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import type { MediaAsset } from '../domain/media-asset-types'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

let counter = 0
const makeId = (prefix = 'clip'): string => `${prefix}_${(counter += 1)}`

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'mic',
    kind: 'audio',
    name: 'mic.wav',
    source: { path: '/tmp/mic.wav', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  applyEditorCommand(document, {
    type: 'clip/insert',
    clipId: 'loi',
    trackId: document.tracks[1].id,
    assetId: 'mic',
    startUs: 0,
    durationUs: 10_000_000,
    sourceInUs: 0
  })
  return document
}

function plan(
  document: ProjectDocument,
  name: string,
  args: unknown,
  extra: Partial<ChatEditContext>
): ReturnType<typeof planChatToolCalls> {
  return planChatToolCalls(
    { document, selectedClipIds: ['loi'], playheadUs: 0, makeId, ...extra },
    [{ name, arguments: args }]
  )
}

describe('remove_silences', () => {
  it('dùng khoảng lặng đã dò sẵn, cắt và dồn lên', () => {
    const document = project()
    const result = plan(
      document,
      'remove_silences',
      { paddingSeconds: 0 },
      { silences: { loi: { intervals: [{ startUs: 4_000_000, endUs: 6_000_000 }] } } }
    )
    expect(result.failures).toEqual([])
    for (const command of result.steps[0].commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[1].clips.reduce((sum, clip) => sum + clip.durationUs, 0)).toBe(8_000_000)
  })

  it('báo đúng lỗi dò của ffmpeg thay vì một câu chung chung', () => {
    const result = plan(
      project(),
      'remove_silences',
      {},
      {
        silences: { loi: { error: 'file hỏng' } }
      }
    )
    expect(result.failures[0].reason).toMatch(/file hỏng/)
  })

  it('không có khoảng lặng nào thì nói cách chỉnh ngưỡng', () => {
    const result = plan(
      project(),
      'remove_silences',
      {},
      {
        silences: { loi: { intervals: [] } }
      }
    )
    expect(result.failures[0].reason).toMatch(/thresholdDb/)
  })
})

describe('clean_voice', () => {
  it('thay clip tiếng sang asset đã làm sạch', () => {
    const document = project()
    const cleaned: MediaAsset = {
      ...document.assets[0],
      id: 'mic_clean',
      origin: 'generated',
      generated: {
        task: 'voice-cleanup',
        providerId: 'ffmpeg',
        model: 'x',
        jobId: 'j',
        requestFingerprint: 'f',
        sourceAssetId: 'mic'
      }
    }
    const result = plan(
      document,
      'clean_voice',
      { strength: 'strong' },
      {
        cleanedVoices: { loi: { asset: cleaned } }
      }
    )
    expect(result.failures).toEqual([])
    for (const command of result.steps[0].commands) {
      expect(applyEditorCommand(document, command).ok).toBe(true)
    }
    expect(document.tracks[1].clips[0].assetId).toBe('mic_clean')
  })

  it('chưa có kết quả làm sạch thì từ chối, không phát lệnh nào', () => {
    const result = plan(project(), 'clean_voice', {}, {})
    expect(result.steps).toEqual([])
    expect(result.failures).toHaveLength(1)
  })
})
