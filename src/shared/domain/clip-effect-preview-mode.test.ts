import { describe, expect, it } from 'vitest'
import { countClipsInEffectPreviewMode } from './clip-effect-preview-mode'
import { createEmptyProject } from './project-document-factory'
import type { ProjectDocument } from './project-document-types'
import type { Clip } from './timeline-track-types'
import type { ClipEffect } from './clip-effect-types'

function clipWith(id: string, effects: ClipEffect[]): Clip {
  return {
    id,
    assetId: 'asset_1',
    startUs: 0,
    durationUs: 1_000_000,
    sourceInUs: 0,
    speed: 1,
    volume: 1,
    fadeInUs: 0,
    fadeOutUs: 0,
    effects
  }
}

function projectWith(...clips: Clip[]): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử' })
  const track = document.tracks.find((item) => item.kind === 'video')!
  track.clips = clips
  return document
}

const skinSmooth = (showArea: string): ClipEffect => ({
  id: 'fx',
  kind: 'skin-smooth',
  intensity: 0.7,
  params: { brighten: 25, range: 50, showArea }
})

describe('đếm effect còn bật chế độ soi', () => {
  it('không có gì bật thì bằng 0', () => {
    expect(countClipsInEffectPreviewMode(null)).toBe(0)
    expect(countClipsInEffectPreviewMode(projectWith())).toBe(0)
    expect(countClipsInEffectPreviewMode(projectWith(clipWith('a', [skinSmooth('off')])))).toBe(0)
  })

  it('đếm theo CLIP, một clip chồng hai effect cùng bật vẫn tính một', () => {
    const twice = clipWith('a', [skinSmooth('on'), { ...skinSmooth('on'), id: 'fx2' }])
    expect(countClipsInEffectPreviewMode(projectWith(twice))).toBe(1)
    expect(
      countClipsInEffectPreviewMode(
        projectWith(twice, clipWith('b', [skinSmooth('on')]), clipWith('c', [skinSmooth('off')]))
      )
    ).toBe(2)
  })

  it('effect khác có thông số tên giống cũng không bị tính nhầm', () => {
    const other: ClipEffect = {
      id: 'fx',
      kind: 'vignette',
      intensity: 1,
      params: { showArea: 'on' }
    }
    expect(countClipsInEffectPreviewMode(projectWith(clipWith('a', [other])))).toBe(0)
  })
})
