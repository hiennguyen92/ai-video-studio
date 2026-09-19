import { describe, expect, it } from 'vitest'
import { sanitizeClipForPaste } from './clip-paste-sanitize'
import { applyEditorCommand } from './editor-command-reducer'
import { createEmptyProject } from '../domain/project-document-factory'
import type { Clip } from '../domain/timeline-track-types'
import type { ProjectDocument } from '../domain/project-document-types'

/**
 * Dán clip.
 *
 * Điều phải chứng minh: bản dán giữ ĐỦ những thứ người ta chép clip vì muốn giữ
 * — âm lượng, fade, tốc độ, transform, effect, keyframe. Lệnh chèn clip thông
 * thường dựng clip mới với giá trị mặc định, nên dán bằng nó là mất sạch.
 */

const rich = (): Clip => ({
  id: 'goc',
  assetId: 'a',
  startUs: 1_000_000,
  durationUs: 3_000_000,
  sourceInUs: 500_000,
  speed: 1.5,
  volume: 1.8,
  fadeInUs: 200_000,
  fadeOutUs: 300_000,
  label: 'Cảnh mở',
  transform: { x: 0.2, y: -0.1, scale: 1.4, rotationDeg: 15, opacity: 0.8 },
  colorGrade: { brightness: 1.1, contrast: 1, saturation: 1, temperature: 0, vignette: 0.3 },
  effects: [{ id: 'e1', kind: 'soft-blur', intensity: 0.4, params: {} }],
  keyframes: {
    'transform.opacity': [
      { atUs: 0, v: 0 },
      { atUs: 1_000_000, v: 1 }
    ]
  },
  linkGroupId: 'cap-hinh-tieng'
})

describe('dựng lại clip khi dán', () => {
  it('giữ đủ những thứ lệnh chèn thông thường sẽ làm mất', () => {
    const pasted = sanitizeClipForPaste(rich(), { id: 'moi', startUs: 9_000_000 })!
    expect(pasted.id).toBe('moi')
    expect(pasted.startUs).toBe(9_000_000)
    expect(pasted.speed).toBe(1.5)
    expect(pasted.volume).toBe(1.8)
    expect(pasted.fadeInUs).toBe(200_000)
    expect(pasted.transform?.scale).toBe(1.4)
    expect(pasted.colorGrade?.vignette).toBe(0.3)
    expect(pasted.effects?.[0].kind).toBe('soft-blur')
    expect(pasted.keyframes?.['transform.opacity']).toHaveLength(2)
    expect(pasted.label).toBe('Cảnh mở')
  })

  it('keyframe sao chép SÂU, không dùng chung với bản gốc', () => {
    const source = rich()
    const pasted = sanitizeClipForPaste(source, { id: 'moi', startUs: 0 })!
    pasted.keyframes!['transform.opacity'][0].v = 0.9
    expect(source.keyframes!['transform.opacity'][0].v).toBe(0)
  })

  it('KHÔNG mang theo nhóm liên kết hình-tiếng', () => {
    // Bản dán là một clip độc lập, không phải mảnh thứ hai của cặp tách ra từ
    // cùng một file — mang theo thì xoá một cái sẽ kéo theo cái kia.
    expect(sanitizeClipForPaste(rich(), { id: 'moi', startUs: 0 })!.linkGroupId).toBeUndefined()
  })

  it('kẹp số ngoài khoảng và bỏ trường lạ', () => {
    // Payload có thể tới từ agent hoặc từ file dự án sửa tay, nên không tin.
    const dirty = {
      ...rich(),
      volume: 99,
      speed: -4,
      fadeInUs: 999_000_000,
      keFactor: 'lạ'
    } as unknown as Clip
    const pasted = sanitizeClipForPaste(dirty, { id: 'moi', startUs: 0 })!
    expect(pasted.volume).toBe(2)
    expect(pasted.speed).toBe(0.1)
    // Fade không dài hơn chính clip.
    expect(pasted.fadeInUs).toBe(3_000_000)
    expect('keFactor' in pasted).toBe(false)
  })

  it('thiếu âm lượng thì về 1, KHÔNG phải 0', () => {
    // Kẹp thẳng một `undefined` sẽ ra 0 — bản dán im tiếng, và nhìn clip trên
    // timeline thì không có dấu hiệu gì.
    const source = { ...rich(), volume: undefined } as unknown as Clip
    expect(sanitizeClipForPaste(source, { id: 'moi', startUs: 0 })!.volume).toBe(1)
  })

  it('bỏ effect có kind không còn trong danh mục', () => {
    const source = {
      ...rich(),
      effects: [{ id: 'e1', kind: 'khong-ton-tai', intensity: 1, params: {} }]
    }
    expect(sanitizeClipForPaste(source, { id: 'moi', startUs: 0 })!.effects).toBeUndefined()
  })

  it('độ dài không hợp lệ thì từ chối hẳn', () => {
    const broken = { ...rich(), durationUs: 0 }
    expect(sanitizeClipForPaste(broken, { id: 'moi', startUs: 0 })).toBeNull()
  })
})

describe('lệnh dán clip', () => {
  const project = (): ProjectDocument => {
    const document = createEmptyProject({ name: 't' })
    document.assets.push({
      id: 'a',
      kind: 'video',
      name: 'a',
      source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
      probe: { durationUs: 30_000_000, hasVideo: true, hasAudio: false },
      derived: {},
      origin: 'import',
      tags: [],
      createdAt: '',
      missing: false
    } as never)
    return document
  }

  const videoTrackId = (document: ProjectDocument): string =>
    document.tracks.find((track) => track.kind === 'video')!.id

  it('dán vào track và giữ nguyên thuộc tính', () => {
    const document = project()
    const result = applyEditorCommand(document, {
      type: 'clip/paste',
      trackId: videoTrackId(document),
      clipId: 'moi',
      startUs: 5_000_000,
      clip: rich()
    })
    expect(result.ok).toBe(true)

    const clip = document.tracks.find((track) => track.kind === 'video')!.clips[0]
    expect(clip.id).toBe('moi')
    expect(clip.startUs).toBe(5_000_000)
    expect(clip.volume).toBe(1.8)
    expect(clip.keyframes?.['transform.opacity']).toHaveLength(2)
  })

  it('từ chối khi media của clip đã chép không còn trong dự án', () => {
    // Dán một clip trỏ tới asset đã xoá là tạo ra clip không bao giờ vẽ được gì.
    const document = project()
    document.assets = []
    const result = applyEditorCommand(document, {
      type: 'clip/paste',
      trackId: videoTrackId(document),
      startUs: 0,
      clip: rich()
    })
    expect(result).toEqual({
      ok: false,
      error: 'Media của clip đã chép không còn trong dự án'
    })
  })

  it('từ chối track đang khoá', () => {
    const document = project()
    const track = document.tracks.find((item) => item.kind === 'video')!
    track.locked = true
    const result = applyEditorCommand(document, {
      type: 'clip/paste',
      trackId: track.id,
      startUs: 0,
      clip: rich()
    })
    expect(result.ok).toBe(false)
  })
})
