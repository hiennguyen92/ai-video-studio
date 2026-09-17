import { describe, expect, it } from 'vitest'
import { applyEditorCommand } from '../commands/editor-command-reducer'
import { createEmptyProject } from './project-document-factory'
import { buildRenderPlan } from './remotion-render-plan'
import { CLIP_LOOKS, findClipLook } from './clip-look-catalog'
import { canonLog3ToLinear, linearToRec709, sLog3ToLinear, sampleCurve } from './clip-look-curves'
import { buildLookFilterSvg, lookFilterId } from './clip-look-svg'

describe('danh mục look màu', () => {
  it('có 16 look, id duy nhất và an toàn làm id bộ lọc', () => {
    expect(CLIP_LOOKS).toHaveLength(16)
    const ids = CLIP_LOOKS.map((look) => look.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('không dùng tên hãng phim hay máy ảnh', () => {
    // Tên trung tính là quyết định có chủ ý: app phát hành không mượn nhãn hiệu.
    const names = CLIP_LOOKS.flatMap((look) => [look.nameVi, look.nameEn]).join(' ')
    expect(names).not.toMatch(/\b(fuji\w*|kodak|ricoh|cinestill|velvia|portra|provia)\b/i)
  })

  it('mọi bước màu đều hợp lệ: bảng đường cong trong 0..1, ma trận đủ 20 số', () => {
    for (const look of CLIP_LOOKS) {
      expect(look.stages.length).toBeGreaterThan(0)
      for (const stage of look.stages) {
        if (stage.type === 'matrix') expect(stage.values).toHaveLength(20)
        if (stage.type === 'curve') {
          for (const table of [stage.r, stage.g, stage.b]) {
            expect(table.length).toBeGreaterThan(2)
            expect(table.every((value) => value >= 0 && value <= 1)).toBe(true)
          }
        }
      }
    }
  })

  it('tra id lạ trả undefined', () => {
    expect(findClipLook('khong-co')).toBeUndefined()
    expect(findClipLook('teal-orange')?.nameEn).toBe('Teal & orange')
  })
})

describe('đường log của máy quay', () => {
  it('xám 18% theo đúng mã log của hãng về đúng 0,18 tuyến tính', () => {
    // S-Log3: xám 18% nằm ở mã 420/1023. Canon Log 3 (thang mã chuẩn hoá 0..1):
    // xám 18% ở khoảng 0,33 — con số 34,3% hay gặp là theo thang IRE, khác thang.
    expect(sLog3ToLinear(420 / 1023)).toBeCloseTo(0.18, 3)
    expect(canonLog3ToLinear(0.33)).toBeCloseTo(0.18, 2)
  })

  it('xám giữa sau chuyển về 709 nằm quanh 40%, không tối sập hay cháy', () => {
    const grey = linearToRec709(0.18)
    expect(grey).toBeGreaterThan(0.35)
    expect(grey).toBeLessThan(0.45)
  })

  it('ma trận gam màu giữ xám là xám: mỗi hàng cộng bằng 1', () => {
    for (const id of ['slog3-to-709', 'canon-log3-to-709']) {
      const stage = findClipLook(id)!.stages.find((item) => item.type === 'matrix')!
      if (stage.type !== 'matrix') throw new Error('thiếu ma trận')
      for (const row of [0, 5, 10]) {
        const sum = stage.values[row] + stage.values[row + 1] + stage.values[row + 2]
        expect(sum).toBeCloseTo(1, 3)
      }
    }
  })

  it('lấy mẫu đường cong luôn kẹp trong 0..1', () => {
    expect(sampleCurve((value) => value * 3 - 1).every((v) => v >= 0 && v <= 1)).toBe(true)
  })
})

describe('bộ lọc SVG của look', () => {
  it('id bộ lọc theo look và cường độ', () => {
    expect(lookFilterId('mono-film', 0.5)).toBe('look-mono-film-50')
    expect(lookFilterId('mono-film', 7)).toBe('look-mono-film-100')
  })

  it('dựng được cho mọi look, thuần ASCII ngoài tên, có id khớp', () => {
    for (const look of CLIP_LOOKS) {
      const svg = buildLookFilterSvg(look, 1)
      expect(svg).toContain(`id="${lookFilterId(look.id, 1)}"`)
      expect(svg).toContain('color-interpolation-filters="sRGB"')
      expect(svg).toMatch(/^[\x20-\x7E]*$/)
      expect(svg).not.toContain('NaN')
    }
  })

  it('cường độ dưới 100% trộn với ảnh gốc, 100% thì không', () => {
    const look = findClipLook('mono-film')!
    expect(buildLookFilterSvg(look, 1)).not.toContain(
      'in2="SourceGraphic" operator="arithmetic" k1="0" k2='
    )
    expect(buildLookFilterSvg(look, 0.3)).toContain('k2="0.3" k3="0.7"')
  })
})

describe('look trên clip qua lệnh và kế hoạch dựng hình', () => {
  function projectWithClip(kind: 'video' | 'audio'): ReturnType<typeof createEmptyProject> {
    const document = createEmptyProject({ name: 'Thử' })
    document.assets.push({
      id: 'asset_1',
      kind: kind === 'audio' ? 'audio' : 'video',
      name: 'a',
      source: { path: '/a', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
      probe: {
        durationUs: 5_000_000,
        hasVideo: kind === 'video',
        hasAudio: true,
        width: 640,
        height: 360
      },
      derived: {},
      origin: 'imported',
      tags: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      missing: false
    } as never)
    const track = document.tracks.find((item) => item.kind === kind)!
    track.clips.push({
      id: 'clip_1',
      assetId: 'asset_1',
      startUs: 0,
      durationUs: 5_000_000,
      sourceInUs: 0,
      speed: 1,
      volume: 1,
      fadeInUs: 0,
      fadeOutUs: 0
    })
    return document
  }

  it('đặt look cho clip hình và tới lớp vẽ với cường độ đã kẹp', () => {
    const document = projectWithClip('video')
    expect(
      applyEditorCommand(document, {
        type: 'clip/set-look',
        clipId: 'clip_1',
        look: { id: 'warm-film', intensity: 0.4 }
      }).ok
    ).toBe(true)
    expect(buildRenderPlan(document).video[0].look).toEqual({ id: 'warm-film', intensity: 0.4 })
  })

  it('clip tiếng không nhận look', () => {
    const document = projectWithClip('audio')
    expect(
      applyEditorCommand(document, {
        type: 'clip/set-look',
        clipId: 'clip_1',
        look: { id: 'warm-film', intensity: 1 }
      }).ok
    ).toBe(false)
  })

  it('id look lạ trong dự án thì mất look chứ không làm hỏng kế hoạch', () => {
    const document = projectWithClip('video')
    document.tracks.find((item) => item.kind === 'video')!.clips[0].look = {
      id: 'look-tu-ban-app-khac',
      intensity: 1
    }
    expect(buildRenderPlan(document).video[0].look).toBeUndefined()
  })
})
