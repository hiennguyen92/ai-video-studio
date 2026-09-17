import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { DEFAULT_SUBTITLE_STYLE } from '../domain/subtitle-types'
import { createDefaultTextOverlayStyle } from '../domain/text-overlay-types'
import { planChatToolCalls } from './chat-tool-planner'

/** Dự án có một transcript ba đoạn, một bản dịch, một track phụ đề và hai chữ overlay. */
function fixture(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.transcripts.push({
    id: 'tr_1',
    assetId: 'asset_1',
    language: 'vi',
    languageAutoDetected: false,
    providerId: 'whisper-cpp',
    model: 'ggml',
    createdAt: '2026-01-01T00:00:00.000Z',
    segments: [
      { id: 's1', startUs: 0, endUs: 1_000_000, text: 'Xin', edited: false },
      { id: 's2', startUs: 1_000_000, endUs: 2_000_000, text: 'chào', edited: false },
      { id: 's3', startUs: 2_000_000, endUs: 3_000_000, text: 'bạn', edited: false }
    ]
  })
  document.translations.push({
    id: 'tl_1',
    transcriptId: 'tr_1',
    sourceLanguage: 'vi',
    targetLanguage: 'en',
    providerId: 'p',
    model: 'm',
    createdAt: '2026-01-01T00:00:00.000Z',
    glossary: [],
    segments: [{ id: 't1', sourceSegmentId: 's1', text: 'Hi', edited: false }]
  })
  document.subtitleTracks.push({
    id: 'sub_1',
    name: 'Phụ đề',
    language: 'vi',
    source: { kind: 'transcript', refId: 'tr_1' },
    style: { ...DEFAULT_SUBTITLE_STYLE, position: { xPct: 0.5, yPct: 0.5 } },
    cues: [{ id: 'c1', startUs: 0, endUs: 1_000_000, text: 'Xin', edited: false }]
  } as never)
  document.tracks.push({ id: 'lane_text_2', kind: 'text', name: 'Text 2', clips: [] } as never)
  for (const id of ['text_a', 'text_b']) {
    document.textOverlays.push({
      id,
      text: id,
      startUs: 0,
      endUs: 1_000_000,
      style: createDefaultTextOverlayStyle(),
      animation: 'none',
      animationDurationUs: 300_000,
      ...(id === 'text_a' ? { frame: { styleId: 'bubble', paletteId: 'pink' } } : {})
    } as never)
  }
  return document
}

/** Lập kế hoạch rồi áp qua reducer thật — chứng minh lệnh sinh ra được chấp nhận. */
function run(document: ProjectDocument, name: string, args: unknown): string[] {
  const plan = planChatToolCalls(
    { document, selectedClipIds: [], playheadUs: 0, makeId: () => 'id_new' },
    [{ name, arguments: args }]
  )
  if (plan.failures.length > 0) return plan.failures.map((failure) => failure.reason)
  for (const command of plan.steps.flatMap((step) => step.commands)) {
    const result = applyEditorCommand(document, command)
    if (!result.ok) throw new Error(result.error)
  }
  return []
}

describe('công cụ sửa transcript và bản dịch', () => {
  it('sửa chữ một đoạn phiên âm và đánh dấu đã sửa tay', () => {
    const document = fixture()
    expect(
      run(document, 'update_transcript_segment', {
        transcriptId: 'tr_1',
        segmentId: 's2',
        text: 'Chào'
      })
    ).toEqual([])
    expect(document.transcripts[0].segments[1]).toMatchObject({ text: 'Chào', edited: true })
  })

  it('gộp đoạn với đoạn kế tiếp, và từ chối gộp đoạn cuối', () => {
    const document = fixture()
    expect(
      run(document, 'merge_transcript_segments', { transcriptId: 'tr_1', segmentId: 's1' })
    ).toEqual([])
    expect(document.transcripts[0].segments.map((segment) => segment.text)).toEqual([
      'Xin chào',
      'bạn'
    ])
    expect(
      run(document, 'merge_transcript_segments', { transcriptId: 'tr_1', segmentId: 's3' })[0]
    ).toContain('đoạn cuối')
  })

  it('xoá transcript kéo theo bản dịch của nó', () => {
    const document = fixture()
    expect(run(document, 'remove_transcript', { transcriptId: 'tr_1' })).toEqual([])
    expect(document.transcripts).toEqual([])
    expect(document.translations).toEqual([])
  })

  it('sửa đoạn dịch, thay glossary, xoá bản dịch', () => {
    const document = fixture()
    expect(
      run(document, 'update_translation_segment', {
        translationId: 'tl_1',
        segmentId: 't1',
        text: 'Hello'
      })
    ).toEqual([])
    expect(document.translations[0].segments[0]).toMatchObject({ text: 'Hello', edited: true })

    expect(
      run(document, 'set_translation_glossary', {
        translationId: 'tl_1',
        entries: [{ from: 'AVS', to: 'AVS' }]
      })
    ).toEqual([])
    expect(document.translations[0].glossary).toEqual([{ from: 'AVS', to: 'AVS' }])

    expect(run(document, 'remove_translation', { translationId: 'tl_1' })).toEqual([])
    expect(document.translations).toEqual([])
  })

  it('báo id lạ bằng lời dễ hiểu thay vì lỗi áp lệnh', () => {
    const document = fixture()
    expect(
      run(document, 'update_translation_segment', {
        translationId: 'nope',
        segmentId: 't1',
        text: 'x'
      })[0]
    ).toContain('Không tìm thấy bản dịch')
  })
})

describe('công cụ track phụ đề', () => {
  it('đổi tên và xoá track phụ đề', () => {
    const document = fixture()
    expect(
      run(document, 'rename_subtitle_track', { subtitleTrackId: 'sub_1', name: 'English' })
    ).toEqual([])
    expect(document.subtitleTracks[0].name).toBe('English')
    expect(run(document, 'remove_subtitle_track', { subtitleTrackId: 'sub_1' })).toEqual([])
    expect(document.subtitleTracks).toEqual([])
  })

  it('sửa dòng thứ hai của cue song ngữ', () => {
    const document = fixture()
    expect(
      run(document, 'update_subtitle_cue', {
        subtitleTrackId: 'sub_1',
        cueId: 'c1',
        secondaryText: 'Hi'
      })
    ).toEqual([])
    expect(document.subtitleTracks[0].cues[0].textSecondary).toBe('Hi')
  })
})

describe('set_text_style', () => {
  it('áp mẫu phụ đề, bóng, số ký tự; neo lại vị trí thì bỏ ghim', () => {
    const document = fixture()
    expect(
      run(document, 'set_text_style', {
        subtitleTrackId: 'sub_1',
        preset: 'solid-box',
        shadowPx: 4,
        maxCharsPerLine: 30,
        position: 'top'
      })
    ).toEqual([])
    const style = document.subtitleTracks[0].style
    expect(style).toMatchObject({
      boxOpacity: 0.75,
      shadowPx: 4,
      maxCharsPerLine: 30,
      alignment: 8
    })
    expect(style.position).toBeUndefined()
    // Trường không nêu giữ nguyên.
    expect(style.fontFamily).toBe(DEFAULT_SUBTITLE_STYLE.fontFamily)
  })

  it('từ chối mẫu lạ và cỡ chữ phụ đề quá trần', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { subtitleTrackId: 'sub_1', preset: 'x' })[0]).toContain(
      'solid-box'
    )
    expect(
      run(document, 'set_text_style', { subtitleTrackId: 'sub_1', fontSizePx: 250 })[0]
    ).toContain('200')
  })

  it('bật nền hộp cho mọi chữ overlay, gỡ khung ở chữ đang có khung', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { box: 'dark', fontSizePx: 120 })).toEqual([])
    for (const overlay of document.textOverlays) {
      expect(overlay.style).toMatchObject({ boxColor: '#000000', fontSizePx: 120 })
      expect(overlay.frame).toBeUndefined()
    }
  })

  it('từ chối trường chỉ dành cho phụ đề khi nhắm chữ overlay, và lời gọi rỗng', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { overlayId: 'text_b', shadowPx: 2 })[0]).toContain(
      'track phụ đề'
    )
    expect(run(document, 'set_text_style', { overlayId: 'text_b' })[0]).toContain('Chưa nêu')
  })
})

describe('công cụ được nới rộng', () => {
  it('update_text_overlay dời chữ sang lane chữ khác và đổi thời lượng hiệu ứng', () => {
    const document = fixture()
    expect(
      run(document, 'update_text_overlay', {
        overlayId: 'text_b',
        trackId: 'lane_text_2',
        animationDurationSeconds: 0.5
      })
    ).toEqual([])
    expect(document.textOverlays[1]).toMatchObject({
      trackId: 'lane_text_2',
      animationDurationUs: 500_000
    })
    expect(
      run(document, 'update_text_overlay', { overlayId: 'text_b', trackId: 'sub_1' })[0]
    ).toContain('không phải lane chữ')
  })

  it('set_track bật solo và đổi vai trò lane tiếng, từ chối vai trò cho lane hình', () => {
    const document = fixture()
    const audio = document.tracks.find((track) => track.kind === 'audio')
    const video = document.tracks.find((track) => track.kind === 'video')
    if (!audio || !video) throw new Error('dự án mẫu thiếu lane')

    expect(run(document, 'set_track', { trackId: audio.id, solo: true, role: 'music' })).toEqual([])
    expect(document.tracks.find((track) => track.id === audio.id)).toMatchObject({
      solo: true,
      role: 'music'
    })
    expect(run(document, 'set_track', { trackId: video.id, role: 'music' })[0]).toContain(
      'lane tiếng'
    )
  })
})

describe('set_text_style giữ khớp giao diện khi chữ có khung', () => {
  it('box none cũng gỡ khung, như ô chọn nền', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { overlayId: 'text_a', box: 'none' })).toEqual([])
    expect(document.textOverlays[0].frame).toBeUndefined()
  })

  it('từ chối chỉnh hộp bằng tay trên chữ có khung khi chưa đặt box', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { overlayId: 'text_a', boxOpacity: 0.5 })[0]).toContain(
      'đặt box'
    )
    expect(document.textOverlays[0].frame).toBeDefined()
  })

  it('neo giữa thì lề dọc về 0', () => {
    const document = fixture()
    expect(run(document, 'set_text_style', { overlayId: 'text_b', position: 'middle' })).toEqual([])
    expect(document.textOverlays[1].style).toMatchObject({ alignment: 5, marginVerticalPx: 0 })
  })

  it('từ chối solo trên lane không phải tiếng', () => {
    const document = fixture()
    const video = document.tracks.find((track) => track.kind === 'video')
    if (!video) throw new Error('dự án mẫu thiếu lane hình')
    expect(run(document, 'set_track', { trackId: video.id, solo: true })[0]).toContain('lane tiếng')
  })
})
