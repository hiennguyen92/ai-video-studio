import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { migrateProjectDocument } from './project-document-migrations'
import { createEmptyProject } from './project-document-factory'
import {
  adjacentMarker,
  chapterListText,
  rippleMarkers,
  type TimelineMarker
} from './timeline-marker-types'

const marker = (id: string, atUs: number, label = ''): TimelineMarker => ({
  id,
  atUs,
  label,
  color: 'blue'
})

describe('rippleMarkers', () => {
  it('xoá marker nằm trong khoảng, dời marker phía sau, giữ marker phía trước', () => {
    const result = rippleMarkers(
      [marker('a', 1_000_000), marker('b', 3_000_000), marker('c', 6_000_000)],
      2_000_000,
      4_000_000
    )
    expect(result.map((item) => [item.id, item.atUs])).toEqual([
      ['a', 1_000_000],
      ['c', 4_000_000]
    ])
  })
})

describe('adjacentMarker', () => {
  const markers = [marker('b', 5_000_000), marker('a', 2_000_000)]

  it('tìm marker kế tiếp và liền trước, bỏ qua marker trùng mốc', () => {
    expect(adjacentMarker(markers, 2_000_000, 1)?.id).toBe('b')
    expect(adjacentMarker(markers, 5_000_000, -1)?.id).toBe('a')
    expect(adjacentMarker(markers, 5_000_000, 1)).toBeUndefined()
  })
})

describe('chapterListText', () => {
  it('in theo thứ tự thời gian, dạng YouTube', () => {
    const text = chapterListText(
      [marker('b', 65_000_000, 'Phần hai'), marker('a', 0, 'Mở đầu'), marker('c', 3_725_000_000)],
      'Intro',
      (index) => `Chương ${index}`
    )
    expect(text).toBe('0:00 Mở đầu\n1:05 Phần hai\n1:02:05 Chương 3')
  })

  it('marker đầu nằm sau 0 thì chèn dòng 0:00 — YouTube bỏ qua danh sách thiếu dòng này', () => {
    expect(chapterListText([marker('a', 30_000_000, 'Demo')], 'Intro', String)).toBe(
      '0:00 Intro\n0:30 Demo'
    )
  })
})

describe('lệnh marker', () => {
  it('thêm, sửa từng trường, xoá', () => {
    const document = createEmptyProject({ name: 'Thử' })
    expect(
      applyEditorCommand(document, { type: 'marker/add', marker: marker('m', 1_000) }).ok
    ).toBe(true)
    expect(
      applyEditorCommand(document, { type: 'marker/add', marker: marker('m', 2_000) }).ok
    ).toBe(false)

    applyEditorCommand(document, {
      type: 'marker/update',
      markerId: 'm',
      patch: { label: 'Hook', atUs: undefined }
    })
    // Trường vắng mặt không được xoá giá trị cũ.
    expect(document.markers[0]).toEqual({ id: 'm', atUs: 1_000, label: 'Hook', color: 'blue' })

    expect(applyEditorCommand(document, { type: 'marker/remove', markerId: 'm' }).ok).toBe(true)
    expect(applyEditorCommand(document, { type: 'marker/remove', markerId: 'm' }).ok).toBe(false)
  })

  it('ripple xoá trên mọi track dời marker; ripple trên một track thì không', () => {
    const document = createEmptyProject({ name: 'Thử' })
    applyEditorCommand(document, { type: 'marker/add', marker: marker('m', 5_000_000) })

    applyEditorCommand(document, {
      type: 'timeline/ripple-delete',
      fromUs: 0,
      toUs: 1_000_000,
      trackIds: [document.tracks[0].id]
    })
    expect(document.markers[0].atUs).toBe(5_000_000)

    applyEditorCommand(document, { type: 'timeline/ripple-delete', fromUs: 0, toUs: 1_000_000 })
    expect(document.markers[0].atUs).toBe(4_000_000)
  })

  it('project cũ không có trường markers vẫn mở được', () => {
    const legacy: Record<string, unknown> = { ...createEmptyProject({ name: 'Cũ' }) }
    delete legacy.markers
    expect(migrateProjectDocument(JSON.parse(JSON.stringify(legacy))).markers).toEqual([])
  })
})
