import { describe, expect, it } from 'vitest'
import { copyKeyframes, pasteKeyframes } from './keyframe-clipboard'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { ClipEffect } from './clip-effect-types'
import type { KeyframeTracks } from './keyframe-types'
import type { ProjectDocument } from './project-document-types'

/**
 * Chép và dán cụm keyframe.
 *
 * Phần dễ sai nhất là EFFECT: keyframe khoá theo id của lần áp effect, mà id đó
 * không bao giờ trùng giữa hai clip. Dán thẳng id nguồn là đẻ ra keyframe mồ
 * côi, chỉ lộ ra khi tình cờ có ai đổi chồng effect.
 */

const tracks: KeyframeTracks = {
  'transform.opacity': [
    { atUs: 0, v: 0 },
    { atUs: 2_000_000, v: 1, e: 'hold' }
  ]
}

const hsl = (id: string): ClipEffect => ({
  id,
  kind: 'hsl',
  intensity: 1,
  params: { hue: 0, saturation: 100, lightness: 0 }
})

describe('chép cụm keyframe', () => {
  it('chủ thể không có keyframe thì không chép được gì', () => {
    expect(copyKeyframes(undefined, undefined, 'clip')).toBeNull()
    expect(copyKeyframes({ 'transform.x': [] }, undefined, 'clip')).toBeNull()
  })

  it('chụp lại LOẠI của từng effect, không chỉ id', () => {
    // Lúc dán, clip nguồn có thể đã đổi chồng effect hoặc đã bị xoá — nên loại
    // phải nằm trong bảng tạm chứ không tra ngược về nguồn.
    const clipboard = copyKeyframes(
      { 'effect.e1.params.hue': [{ atUs: 0, v: 90 }] },
      [hsl('e1')],
      'clip'
    )
    expect(clipboard?.effectKinds).toEqual({ e1: 'hsl' })
  })

  it('bản chép không dùng chung mảng với nguồn', () => {
    const source = { 'transform.opacity': [{ atUs: 0, v: 0 }] }
    const clipboard = copyKeyframes(source, undefined, 'clip')!
    clipboard.tracks['transform.opacity'][0].v = 0.5
    expect(source['transform.opacity'][0].v).toBe(0)
  })
})

describe('dán sang clip khác', () => {
  it('giữ nguyên mốc, giá trị và kiểu nội suy', () => {
    // KHÔNG co giãn theo độ dài clip đích: co giãn sẽ lặng lẽ đổi nhịp chuyển
    // động thành thứ người dùng không yêu cầu.
    const clipboard = copyKeyframes(tracks, undefined, 'clip')!
    const result = pasteKeyframes(clipboard, { kind: 'clip', effects: undefined })
    expect(result.dropped).toBe(0)
    expect(result.tracks['transform.opacity']).toEqual(tracks['transform.opacity'])
  })

  it('effect ánh xạ theo LOẠI, không theo id', () => {
    const clipboard = copyKeyframes(
      { 'effect.nguon-1.params.hue': [{ atUs: 0, v: 90 }] },
      [hsl('nguon-1')],
      'clip'
    )!
    const result = pasteKeyframes(clipboard, { kind: 'clip', effects: [hsl('dich-9')] })
    expect(result.dropped).toBe(0)
    expect(Object.keys(result.tracks)).toEqual(['effect.dich-9.params.hue'])
  })

  it('nhiều effect cùng loại thì khớp theo thứ tự', () => {
    const clipboard = copyKeyframes(
      {
        'effect.a1.intensity': [{ atUs: 0, v: 0.2 }],
        'effect.a2.intensity': [{ atUs: 0, v: 0.9 }]
      },
      [hsl('a1'), hsl('a2')],
      'clip'
    )!
    const result = pasteKeyframes(clipboard, { kind: 'clip', effects: [hsl('b1'), hsl('b2')] })
    expect(result.tracks['effect.b1.intensity'][0].v).toBe(0.2)
    expect(result.tracks['effect.b2.intensity'][0].v).toBe(0.9)
  })

  it('đích không có effect cùng loại thì BỎ đường đó và đếm lại', () => {
    // Bỏ im lặng là kiểu hỏng người dùng chỉ phát hiện khi tua tới đúng chỗ.
    const clipboard = copyKeyframes(
      {
        'transform.opacity': [{ atUs: 0, v: 1 }],
        'effect.e1.params.hue': [{ atUs: 0, v: 90 }]
      },
      [hsl('e1')],
      'clip'
    )!
    const result = pasteKeyframes(clipboard, { kind: 'clip', effects: [] })
    expect(Object.keys(result.tracks)).toEqual(['transform.opacity'])
    expect(result.dropped).toBe(1)
  })

  it('dán cụm của clip sang chữ thì bỏ sạch', () => {
    const clipboard = copyKeyframes(tracks, undefined, 'clip')!
    const result = pasteKeyframes(clipboard, { kind: 'text' })
    expect(result.tracks).toEqual({})
    expect(result.dropped).toBe(1)
  })
})

describe('lệnh dán ghi vào tài liệu', () => {
  const project = (): ProjectDocument => {
    const document = createEmptyProject({ name: 't' })
    const track = document.tracks.find((item) => item.kind === 'video')!
    track.clips.push({
      id: 'c1',
      startUs: 0,
      durationUs: 5_000_000,
      sourceInUs: 0,
      speed: 1,
      volume: 1,
      fadeInUs: 0,
      fadeOutUs: 0,
      keyframes: {
        'transform.opacity': [{ atUs: 100, v: 0.1 }],
        'transform.scale': [{ atUs: 100, v: 2 }]
      }
    })
    return document
  }

  it('THAY cả đường cùng tên, giữ nguyên đường không liên quan', () => {
    // Trộn hai cụm của hai clip khác nhau ra một thứ không ai đoán được.
    const document = project()
    const result = applyEditorCommand(document, {
      type: 'keyframe/set-tracks',
      target: { kind: 'clip', clipId: 'c1' },
      tracks: {
        'transform.opacity': [
          { atUs: 0, v: 0 },
          { atUs: 1_000_000, v: 1 }
        ]
      }
    })
    expect(result.ok).toBe(true)

    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    expect(clip.keyframes?.['transform.opacity']).toHaveLength(2)
    expect(clip.keyframes?.['transform.scale']).toEqual([{ atUs: 100, v: 2 }])
  })

  it('giá trị ngoài khoảng vẫn bị kẹp như mọi đường ghi khác', () => {
    const document = project()
    applyEditorCommand(document, {
      type: 'keyframe/set-tracks',
      target: { kind: 'clip', clipId: 'c1' },
      tracks: { 'transform.opacity': [{ atUs: 0, v: 40 }] }
    })
    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    expect(clip.keyframes?.['transform.opacity'][0].v).toBe(1)
  })

  it('đường dẫn lạ làm CẢ cú dán bị từ chối, tài liệu không đổi nửa vời', () => {
    const document = project()
    const result = applyEditorCommand(document, {
      type: 'keyframe/set-tracks',
      target: { kind: 'clip', clipId: 'c1' },
      tracks: {
        'transform.opacity': [{ atUs: 0, v: 0 }],
        'transform.khong-co-that': [{ atUs: 0, v: 0 }]
      }
    })
    expect(result.ok).toBe(false)
    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    // Vẫn là đúng một keyframe như lúc đầu.
    expect(clip.keyframes?.['transform.opacity']).toEqual([{ atUs: 100, v: 0.1 }])
  })
})
