import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import type { Transcript, Translation } from '../domain/transcript-types'
import { applyEditorCommand } from './editor-command-reducer'

/**
 * Bất biến của chuỗi transcript → bản dịch.
 *
 * Điều quan trọng nhất không phải là lệnh chạy được, mà là liên kết giữa đoạn
 * gốc và đoạn dịch không bao giờ đứt: mọi thứ dựng tiếp lên trên (phụ đề, lồng
 * tiếng) đều lấy mốc thời gian từ đoạn gốc thông qua liên kết đó.
 */

function transcript(): Transcript {
  return {
    id: 'tr_1',
    assetId: 'asset_1',
    language: 'en',
    languageAutoDetected: false,
    providerId: 'whisper-cpp',
    model: 'ggml-base.en.bin',
    createdAt: new Date().toISOString(),
    segments: [
      { id: 'src_1', startUs: 0, endUs: 1_000_000, text: 'Hello', edited: false },
      { id: 'src_2', startUs: 1_000_000, endUs: 2_000_000, text: 'World', edited: false }
    ]
  }
}

function translation(): Translation {
  return {
    id: 'tl_1',
    transcriptId: 'tr_1',
    sourceLanguage: 'en',
    targetLanguage: 'vi',
    providerId: 'openai-compatible-chat',
    model: 'qwen2.5:7b',
    createdAt: new Date().toISOString(),
    glossary: [],
    segments: [
      { id: 'dst_1', sourceSegmentId: 'src_1', text: 'Xin chào', edited: false },
      { id: 'dst_2', sourceSegmentId: 'src_2', text: 'Thế giới', edited: false }
    ]
  }
}

function projectWithTranscript(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.transcripts.push(transcript())
  return document
}

describe('lệnh bản dịch', () => {
  it('thêm được bản dịch gắn với transcript có thật', () => {
    const document = projectWithTranscript()
    const result = applyEditorCommand(document, {
      type: 'translation/add',
      translation: translation()
    })

    expect(result.ok).toBe(true)
    expect(document.translations).toHaveLength(1)
  })

  it('từ chối bản dịch mồ côi, không gắn vào transcript nào', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const result = applyEditorCommand(document, {
      type: 'translation/add',
      translation: translation()
    })

    expect(result.ok).toBe(false)
    expect(document.translations).toHaveLength(0)
  })

  it('từ chối thêm trùng id', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })
    const result = applyEditorCommand(document, {
      type: 'translation/add',
      translation: translation()
    })

    expect(result.ok).toBe(false)
    expect(document.translations).toHaveLength(1)
  })

  it('sửa một đoạn dịch và đánh dấu đã sửa tay', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })

    const result = applyEditorCommand(document, {
      type: 'translation/update-segment',
      translationId: 'tl_1',
      segmentId: 'dst_1',
      text: 'Chào bạn'
    })

    expect(result.ok).toBe(true)
    const segment = document.translations[0].segments[0]
    expect(segment.text).toBe('Chào bạn')
    // Cờ này để lần dịch lại không xoá công sức chỉnh tay.
    expect(segment.edited).toBe(true)
    // Liên kết về đoạn gốc phải giữ nguyên sau khi sửa.
    expect(segment.sourceSegmentId).toBe('src_1')
  })

  it('thay cả bảng glossary trong một lệnh', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })

    const result = applyEditorCommand(document, {
      type: 'translation/set-glossary',
      translationId: 'tl_1',
      glossary: [{ from: 'timeline', to: 'dòng thời gian' }]
    })

    expect(result.ok).toBe(true)
    expect(document.translations[0].glossary).toEqual([{ from: 'timeline', to: 'dòng thời gian' }])
  })

  it('báo lỗi khi sửa đoạn không tồn tại thay vì im lặng bỏ qua', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })

    const result = applyEditorCommand(document, {
      type: 'translation/update-segment',
      translationId: 'tl_1',
      segmentId: 'khong_co',
      text: 'x'
    })
    expect(result.ok).toBe(false)
  })

  it('xoá transcript thì xoá luôn bản dịch phụ thuộc, không để lại dữ liệu mồ côi', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })

    const result = applyEditorCommand(document, { type: 'transcript/remove', transcriptId: 'tr_1' })

    expect(result.ok).toBe(true)
    expect(document.transcripts).toHaveLength(0)
    expect(document.translations).toHaveLength(0)
  })

  it('sửa đoạn gốc KHÔNG đụng tới bản dịch — hai lớp dữ liệu tách riêng', () => {
    const document = projectWithTranscript()
    applyEditorCommand(document, { type: 'translation/add', translation: translation() })

    applyEditorCommand(document, {
      type: 'transcript/update-segment',
      transcriptId: 'tr_1',
      segmentId: 'src_1',
      text: 'Hello again'
    })

    // Bản dịch giữ nguyên và vẫn trỏ đúng đoạn gốc; người dùng tự quyết dịch lại.
    expect(document.translations[0].segments[0].text).toBe('Xin chào')
    expect(document.translations[0].segments[0].sourceSegmentId).toBe('src_1')
  })
})
