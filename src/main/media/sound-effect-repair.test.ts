import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { repairBuiltinAssetPaths } from './sound-effect-library'

/**
 * Trỏ lại đường dẫn cho hiệu ứng dựng sẵn.
 *
 * Đây là chỗ cả quyết định "giải theo id" đứng lên. Sai ở đây thì dự án cũ mở
 * trên bản cài mới báo thiếu media cho những file đang nằm ngay trong app — và
 * người dùng không có cách nào tự sửa, vì file họ được yêu cầu tìm lại nằm bên
 * trong gói cài.
 */

function asset(overrides: Partial<MediaAsset['source']> & { id: string }): MediaAsset {
  const { id, ...source } = overrides
  return {
    id,
    kind: 'audio',
    name: id,
    source: {
      path: '/ban-cai-cu/sound-effects/pop.mp3',
      contentHash: 'hash',
      sizeBytes: 1,
      mtimeMs: 0,
      ...source
    },
    probe: { durationUs: 180_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'builtin',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

const resolver = (id: string): string | null =>
  id === 'pop' ? '/ban-cai-moi/sound-effects/pop.mp3' : null

describe('repairBuiltinAssetPaths', () => {
  it('trỏ lại đường dẫn theo id của bản cài đang chạy', () => {
    const assets = [asset({ id: 'a', builtinId: 'pop' })]
    expect(repairBuiltinAssetPaths(assets, resolver)).toBe(1)
    expect(assets[0].source.path).toBe('/ban-cai-moi/sound-effects/pop.mp3')
  })

  it('không đụng tới media người dùng tự nhập', () => {
    // Media nhập tay không có `builtinId`; trỏ lại là phá dữ liệu của người dùng.
    const assets = [asset({ id: 'a', path: '/nha-toi/quay.mp4' })]
    expect(repairBuiltinAssetPaths(assets, resolver)).toBe(0)
    expect(assets[0].source.path).toBe('/nha-toi/quay.mp4')
  })

  it('đường dẫn đã đúng thì không đếm là đã sửa', () => {
    // Nơi gọi dựa vào con số này để quyết định có ghi lại dự án hay không; đếm
    // thừa là ghi đĩa mỗi lần mở dự án mà chẳng đổi gì.
    const assets = [
      asset({ id: 'a', builtinId: 'pop', path: '/ban-cai-moi/sound-effects/pop.mp3' })
    ]
    expect(repairBuiltinAssetPaths(assets, resolver)).toBe(0)
  })

  it('id lạ thì GIỮ NGUYÊN đường dẫn cũ, không xoá', () => {
    // Bản cài mới bỏ một hiệu ứng khỏi danh mục là chuyện có thể xảy ra. Xoá
    // đường dẫn đi là mất luôn manh mối cuối cùng để người dùng lần theo.
    const assets = [asset({ id: 'a', builtinId: 'da-bo-di' })]
    expect(repairBuiltinAssetPaths(assets, resolver)).toBe(0)
    expect(assets[0].source.path).toBe('/ban-cai-cu/sound-effects/pop.mp3')
  })

  it('sửa nhiều asset trong một lượt', () => {
    const assets = [
      asset({ id: 'a', builtinId: 'pop' }),
      asset({ id: 'b', path: '/nha-toi/nhac.mp3' }),
      asset({ id: 'c', builtinId: 'pop' })
    ]
    expect(repairBuiltinAssetPaths(assets, resolver)).toBe(2)
  })
})
