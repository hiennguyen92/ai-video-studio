import { describe, expect, it } from 'vitest'
import { selectProjectGarbage, totalBytes, type ProjectFileEntry } from './project-garbage-selector'

/**
 * Chọn file rác.
 *
 * Đây là phần NGUY HIỂM nhất của việc dọn rác: chọn sai thì xoá mất thứ đang
 * dùng, và không có bước nào phía sau bắt lại được. Nên test ở đây thiên hẳn về
 * chứng minh những thứ KHÔNG được đụng tới.
 */

const file = (path: string, sizeBytes = 100): ProjectFileEntry => ({
  path,
  name: path.split('/').at(-1) as string,
  sizeBytes
})

describe('thư mục media', () => {
  it('xoá file không còn asset nào trỏ tới', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [file('/p/media/giong-doc-cu.mp3'), file('/p/media/giong-doc-dang-dung.mp3')],
      cacheEntries: [],
      referencedPaths: ['/p/media/giong-doc-dang-dung.mp3'],
      liveAssetIds: []
    })

    expect(selection.media.map((entry) => entry.name)).toEqual(['giong-doc-cu.mp3'])
  })

  it('không đụng tới file đang được trỏ tới', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [file('/p/media/nhac.mp3')],
      cacheEntries: [],
      referencedPaths: ['/p/media/nhac.mp3'],
      liveAssetIds: []
    })

    expect(selection.media).toEqual([])
  })

  it('không có asset nào thì cả thư mục media là rác', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [file('/p/media/a.mp3'), file('/p/media/b.mp3')],
      cacheEntries: [],
      referencedPaths: [],
      liveAssetIds: []
    })

    expect(selection.media).toHaveLength(2)
  })
})

describe('thư mục cache', () => {
  it('xoá file mang id của asset đã bị xoá', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [],
      cacheEntries: [
        file('/p/cache/asset_da_xoa-thumb.jpg'),
        file('/p/cache/asset_da_xoa-peaks.bin'),
        file('/p/cache/asset_con_song-thumb.jpg')
      ],
      referencedPaths: [],
      liveAssetIds: ['asset_con_song']
    })

    expect(selection.cache.map((entry) => entry.name).sort()).toEqual([
      'asset_da_xoa-peaks.bin',
      'asset_da_xoa-thumb.jpg'
    ])
  })

  it('nhận ra id nằm giữa tên, không chỉ ở đầu', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [],
      cacheEntries: [file('/p/cache/shots-asset_da_xoa.json'), file('/p/cache/shots-asset_song')],
      referencedPaths: [],
      liveAssetIds: ['asset_song']
    })

    expect(selection.cache.map((entry) => entry.name)).toEqual(['shots-asset_da_xoa.json'])
  })

  it('KHÔNG BAO GIỜ xoá chỉ mục dùng lại kết quả', () => {
    // Xoá nó khiến mọi thứ đã sinh bị sinh lại — với provider tính tiền là tiền
    // mất thật.
    const selection = selectProjectGarbage({
      mediaFiles: [],
      cacheEntries: [file('/p/cache/job-results.json')],
      referencedPaths: [],
      liveAssetIds: []
    })

    expect(selection.cache).toEqual([])
  })

  it('để nguyên file cache không mang id asset nào', () => {
    // Dọn nhầm một thứ mình không hiểu là cách nhanh nhất để hỏng tính năng khác.
    const selection = selectProjectGarbage({
      mediaFiles: [],
      cacheEntries: [file('/p/cache/mot-loai-cache-moi.bin'), file('/p/cache/tam.tmp')],
      referencedPaths: [],
      liveAssetIds: []
    })

    expect(selection.cache).toEqual([])
  })

  it('giữ file cache đang được asset trỏ thẳng tới, kể cả khi tên không mang id', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [],
      cacheEntries: [file('/p/cache/thumb-la.jpg')],
      referencedPaths: ['/p/cache/thumb-la.jpg'],
      liveAssetIds: []
    })

    expect(selection.cache).toEqual([])
  })

  it('tên mang nhiều id thì chỉ xoá khi MỌI id đều đã chết', () => {
    const entries = [file('/p/cache/asset_a-asset_b-ghep.jpg')]

    expect(
      selectProjectGarbage({
        mediaFiles: [],
        cacheEntries: entries,
        referencedPaths: [],
        liveAssetIds: ['asset_b']
      }).cache
    ).toEqual([])

    expect(
      selectProjectGarbage({
        mediaFiles: [],
        cacheEntries: entries,
        referencedPaths: [],
        liveAssetIds: []
      }).cache
    ).toHaveLength(1)
  })
})

describe('totalBytes', () => {
  it('cộng cả hai thư mục', () => {
    const selection = selectProjectGarbage({
      mediaFiles: [file('/p/media/a.mp3', 1000)],
      cacheEntries: [file('/p/cache/asset_x-thumb.jpg', 250)],
      referencedPaths: [],
      liveAssetIds: []
    })

    expect(totalBytes(selection)).toBe(1250)
  })

  it('không có gì để dọn thì bằng 0', () => {
    expect(totalBytes({ media: [], cache: [] })).toBe(0)
  })
})
