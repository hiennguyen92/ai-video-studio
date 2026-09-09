import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ProjectDocument } from '../domain/project-document-types'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleCue } from '../domain/subtitle-types'
import { applyEditorCommand } from './editor-command-reducer'

/**
 * Dời khối chữ sang lane khác.
 *
 * Điều cần chứng minh: khối chỉ nằm ở ĐÚNG MỘT chỗ sau khi dời, và lệnh từ chối
 * rõ ràng khi lane đích không nhận được — chứ không âm thầm để lại một dòng chữ
 * trỏ vào lane không tồn tại, vì dòng như vậy vẫn vẽ lên hình mà không còn chỗ
 * nào trên timeline để bấm vào.
 */

let counter = 0
const makeId = (): string => `gen_${(counter += 1)}`

function addTextLane(document: ProjectDocument, name: string): string {
  const before = new Set(document.tracks.map((track) => track.id))
  expect(applyEditorCommand(document, { type: 'track/add', kind: 'text', name }, makeId).ok).toBe(
    true
  )
  return document.tracks.find((track) => !before.has(track.id))!.id
}

function addOverlay(document: ProjectDocument, id: string, trackId?: string): void {
  document.textOverlays.push({
    id,
    trackId,
    text: id,
    startUs: 0,
    endUs: 1_000_000,
    style: { ...DEFAULT_SUBTITLE_STYLE },
    animation: 'none',
    animationDurationUs: 0
  })
}

function cue(id: string, startUs: number): SubtitleCue {
  return { id, startUs, endUs: startUs + 500_000, text: id, edited: false }
}

function projectWithSubtitles(): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  document.subtitleTracks.push(
    {
      id: 'sub_vi',
      name: 'Tiếng Việt',
      language: 'vi',
      source: { kind: 'manual' },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [cue('cue_1', 0), cue('cue_2', 2_000_000)]
    },
    {
      id: 'sub_en',
      name: 'English',
      language: 'en',
      source: { kind: 'manual' },
      style: { ...DEFAULT_SUBTITLE_STYLE },
      cues: [cue('cue_en', 1_000_000)]
    }
  )
  return document
}

describe('dời chữ overlay sang lane khác', () => {
  it('đổi lane bằng text/update', () => {
    const document = createEmptyProject({ name: 'Thử' })
    const first = addTextLane(document, 'Text 1')
    const second = addTextLane(document, 'Text 2')
    addOverlay(document, 'text_1', first)

    expect(
      applyEditorCommand(document, {
        type: 'text/update',
        overlayId: 'text_1',
        trackId: second
      }).ok
    ).toBe(true)
    expect(document.textOverlays[0].trackId).toBe(second)
  })

  it('từ chối lane không tồn tại', () => {
    const document = createEmptyProject({ name: 'Thử' })
    addTextLane(document, 'Text 1')
    addOverlay(document, 'text_1')

    const result = applyEditorCommand(document, {
      type: 'text/update',
      overlayId: 'text_1',
      trackId: 'lane_ma'
    })
    expect(result.ok).toBe(false)
    expect(document.textOverlays[0].trackId).toBeUndefined()
  })

  it('từ chối lane không phải lane chữ', () => {
    const document = createEmptyProject({ name: 'Thử' })
    applyEditorCommand(document, { type: 'track/add', kind: 'video', name: 'Video 1' }, makeId)
    const videoLane = document.tracks.at(-1)!.id
    addTextLane(document, 'Text 1')
    addOverlay(document, 'text_1')

    // Nhận bừa thì dòng chữ trỏ vào một lane hình, và lane hình không vẽ nó ra.
    expect(
      applyEditorCommand(document, {
        type: 'text/update',
        overlayId: 'text_1',
        trackId: videoLane
      }).ok
    ).toBe(false)
  })

  it('đổi lane cùng lúc với đổi giờ trong MỘT lệnh', () => {
    const document = createEmptyProject({ name: 'Thử' })
    addTextLane(document, 'Text 1')
    const second = addTextLane(document, 'Text 2')
    addOverlay(document, 'text_1')

    expect(
      applyEditorCommand(document, {
        type: 'text/update',
        overlayId: 'text_1',
        trackId: second,
        startUs: 3_000_000,
        endUs: 5_000_000
      }).ok
    ).toBe(true)
    // Một bước hoàn tác phải trả lại cả hai thứ, nên chúng phải đi cùng một lệnh.
    expect(document.textOverlays[0]).toMatchObject({
      trackId: second,
      startUs: 3_000_000,
      endUs: 5_000_000
    })
  })
})

describe('dời cue sang track phụ đề khác', () => {
  it('cue rời track cũ và sang track mới, không nằm ở cả hai', () => {
    const document = projectWithSubtitles()
    expect(
      applyEditorCommand(document, {
        type: 'subtitle/move-cue',
        fromTrackId: 'sub_vi',
        toTrackId: 'sub_en',
        cueId: 'cue_1'
      }).ok
    ).toBe(true)

    expect(document.subtitleTracks[0].cues.map((item) => item.id)).toEqual(['cue_2'])
    expect(document.subtitleTracks[1].cues.map((item) => item.id)).toContain('cue_1')
  })

  it('chèn đúng chỗ theo thời gian trong track đích', () => {
    const document = projectWithSubtitles()
    applyEditorCommand(document, {
      type: 'subtitle/move-cue',
      fromTrackId: 'sub_vi',
      toTrackId: 'sub_en',
      cueId: 'cue_2'
    })

    // cue_2 bắt đầu ở 2s, sau cue_en ở 1s. Sai thứ tự thì file SRT/ASS ghi ra có
    // mốc thời gian nhảy lùi và trình phát tua không đúng.
    expect(document.subtitleTracks[1].cues.map((item) => item.id)).toEqual(['cue_en', 'cue_2'])
  })

  it('dời kèm đổi giờ thì chèn theo giờ MỚI', () => {
    const document = projectWithSubtitles()
    applyEditorCommand(document, {
      type: 'subtitle/move-cue',
      fromTrackId: 'sub_vi',
      toTrackId: 'sub_en',
      cueId: 'cue_2',
      startUs: 0,
      endUs: 500_000
    })

    expect(document.subtitleTracks[1].cues.map((item) => item.id)).toEqual(['cue_2', 'cue_en'])
  })

  it('cùng một track thì chỉ đổi giờ, không nhân đôi cue', () => {
    const document = projectWithSubtitles()
    applyEditorCommand(document, {
      type: 'subtitle/move-cue',
      fromTrackId: 'sub_vi',
      toTrackId: 'sub_vi',
      cueId: 'cue_1',
      startUs: 4_000_000,
      endUs: 4_500_000
    })

    expect(document.subtitleTracks[0].cues.map((item) => item.id)).toEqual(['cue_1', 'cue_2'])
    expect(document.subtitleTracks[0].cues[0].startUs).toBe(4_000_000)
  })

  it('khoảng ngược bị từ chối TRƯỚC khi cue bị gỡ khỏi track cũ', () => {
    const document = projectWithSubtitles()
    const result = applyEditorCommand(document, {
      type: 'subtitle/move-cue',
      fromTrackId: 'sub_vi',
      toTrackId: 'sub_en',
      cueId: 'cue_1',
      startUs: 5_000_000,
      endUs: 1_000_000
    })

    expect(result.ok).toBe(false)
    // Thoát giữa chừng sau khi đã gỡ cue ra là làm mất hẳn nó.
    expect(document.subtitleTracks[0].cues.map((item) => item.id)).toEqual(['cue_1', 'cue_2'])
    expect(document.subtitleTracks[1].cues).toHaveLength(1)
  })

  it('track đích không có thật thì không đụng vào track nguồn', () => {
    const document = projectWithSubtitles()
    expect(
      applyEditorCommand(document, {
        type: 'subtitle/move-cue',
        fromTrackId: 'sub_vi',
        toTrackId: 'sub_khong_co',
        cueId: 'cue_1'
      }).ok
    ).toBe(false)
    expect(document.subtitleTracks[0].cues).toHaveLength(2)
  })
})
