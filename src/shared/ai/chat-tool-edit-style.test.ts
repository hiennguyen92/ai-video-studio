import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject, createId } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { planChatToolCalls, type ChatEditContext } from './chat-tool-planner'

/**
 * Công cụ `apply_edit_style` — kiểu dựng trên đường agent và MCP.
 *
 * Agent vốn gọi được từng công cụ lẻ để làm y hệt. Cái nó không có là bộ giá trị
 * đã chọn sẵn, nên được bảo "làm video ngắn dọc" thì nó tự bịa ra một cách dựng
 * khác với cái thẻ người dùng bấm trong app. Một danh mục, hai lối vào.
 */

function project(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.assets.push({
    id: 'asset_1',
    kind: 'video',
    name: 'canh.mp4',
    source: { path: '/tmp/a.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 60_000_000, hasVideo: true, hasAudio: true, width: 2160, height: 3840 },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  })
  return document
}

function addClips(document: ProjectDocument, count: number): void {
  const track = document.tracks.find((item) => item.kind === 'video')!
  for (let index = 0; index < count; index++) {
    const result = applyEditorCommand(document, {
      type: 'clip/insert',
      clipId: createId('clip'),
      trackId: track.id,
      assetId: 'asset_1',
      startUs: index * 2_000_000,
      durationUs: 2_000_000,
      sourceInUs: 1_000_000
    })
    if (!result.ok) throw new Error(result.error)
  }
}

const context = (document: ProjectDocument): ChatEditContext => ({
  document,
  selectedClipIds: [],
  playheadUs: 0,
  makeId: (prefix) => createId(prefix ?? 'clip')
})

function apply(document: ProjectDocument, styleId: string): ReturnType<typeof planChatToolCalls> {
  const plan = planChatToolCalls(context(document), [
    { name: 'apply_edit_style', arguments: { styleId } }
  ])
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    expect(applyEditorCommand(document, command).ok).toBe(true)
  }
  return plan
}

describe('apply_edit_style', () => {
  it('áp đúng những gì thẻ trong app áp', () => {
    const document = project()
    addClips(document, 3)
    apply(document, 'vertical-short')

    const clips = document.tracks.find((track) => track.kind === 'video')!.clips
    expect(document.settings.aspectRatio).toBe('9:16')
    expect(clips.every((clip) => clip.motion?.kind === 'punch-in')).toBe(true)
    expect(clips.every((clip) => clip.look?.id === 'street-contrast')).toBe(true)
    // Ba clip liền nhau là hai chỗ nối.
    expect(clips.filter((clip) => clip.transitionOut).length).toBe(2)
  })

  it('GIỮ độ phân giải dự án, không hạ 4K xuống 1080p', () => {
    const document = project()
    document.settings = { ...document.settings, aspectRatio: '9:16', width: 2160, height: 3840 }
    addClips(document, 2)
    apply(document, 'cinematic')
    expect(document.settings.width).toBe(3840)
    expect(document.settings.height).toBe(2160)
  })

  it('kể lại từng việc đã làm, để agent đọc được kết quả', () => {
    const document = project()
    addClips(document, 2)
    const plan = apply(document, 'tutorial')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].description).toContain('Đổi khung hình')
    expect(plan.steps[0].description).toContain('transition')
  })

  it('nói ra khi kiểu dựng lật hướng khung', () => {
    // Cùng lời cảnh báo mà người dùng đọc trong phần xem trước.
    const document = project()
    document.settings = { ...document.settings, aspectRatio: '9:16', width: 2160, height: 3840 }
    addClips(document, 2)
    const plan = apply(document, 'cinematic')
    expect(plan.steps[0].description).toContain('dải đen')
  })

  it('timeline trống thì chỉ đặt khung, và nói rõ là chỉ có thế', () => {
    // Giống hệt giao diện: thẻ vẫn bấm được, phần xem trước chỉ liệt kê bước đổi
    // khung. Mô tả trả về phải kể đúng ngần ấy, để agent không tưởng đã dựng xong.
    const document = project()
    const plan = apply(document, 'vertical-short')
    expect(document.settings.aspectRatio).toBe('9:16')
    expect(plan.steps[0].description).toContain('Đổi khung hình')
    expect(plan.steps[0].description).not.toContain('transition')
    expect(plan.steps[0].commands).toHaveLength(1)
  })

  it('tên kiểu lạ bị từ chối', () => {
    const plan = planChatToolCalls(context(project()), [
      { name: 'apply_edit_style', arguments: { styleId: 'khong-co' } }
    ])
    expect(plan.failures).toHaveLength(1)
  })
})
