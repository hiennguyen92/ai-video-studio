import { describe, expect, it } from 'vitest'
import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import { formatImportOutcome, relativePaths } from './mcp-import-media-reply'

/**
 * Trả lời của `import_media` là thứ DUY NHẤT agent đọc được sau khi nhập.
 *
 * Thiếu id trong đó thì agent phải gọi thêm `list_media` mới đặt được clip; im
 * lặng bỏ qua file trùng thì agent tưởng nhập hỏng và đi nhập lại mãi.
 */

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'asset_1',
    kind: 'video',
    name: 'canh-quay.mp4',
    source: { path: '/tmp/canh-quay.mp4', contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 5_000_000, hasVideo: true, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false,
    ...overrides
  }
}

type Outcome = NonNullable<Parameters<typeof formatImportOutcome>[0]>

const outcome = (over: Partial<Outcome> = {}): Outcome => ({
  importedCount: 0,
  duplicateCount: 0,
  failures: [],
  assets: [],
  duplicates: [],
  ...over
})

describe('chốt chặn đường dẫn của import_media', () => {
  it('nhận đường dẫn tuyệt đối', () => {
    expect(relativePaths(['/tmp/a.mp4', '/Users/x/b.mov'])).toEqual([])
  })

  it('bắt đường dẫn tương đối và trả về đúng cái sai', () => {
    // Trả về DANH SÁCH chứ không phải true/false: agent gửi nhiều file một lượt
    // và cần biết cái nào sai để sửa đúng cái đó.
    expect(relativePaths(['/tmp/a.mp4', 'b.mp4', './c.mp4'])).toEqual(['b.mp4', './c.mp4'])
  })
})

describe('trả lời của import_media', () => {
  it('nêu id, loại, thời lượng và có tiếng hay không', () => {
    const text = formatImportOutcome(outcome({ assets: [asset()], importedCount: 1 }))

    expect(text).toContain('id=asset_1')
    expect(text).toContain('video')
    expect(text).toContain('5.00s')
    expect(text).toContain('+audio')
    // Nói luôn bước tiếp theo: agent vừa nhập xong thường muốn đặt lên timeline.
    expect(text).toContain('insert_clip')
  })

  it('file không có tiếng thì không gắn nhãn +audio', () => {
    const im = asset({ kind: 'image', probe: { durationUs: 0, hasVideo: true, hasAudio: false } })
    expect(formatImportOutcome(outcome({ assets: [im], importedCount: 1 }))).not.toContain('+audio')
  })

  it('file trùng phải nói ra kèm id của bản đã có', () => {
    const text = formatImportOutcome(
      outcome({
        duplicates: [{ path: '/tmp/a.mp4', existingAssetId: 'asset_cu' }],
        duplicateCount: 1
      })
    )

    expect(text).toContain('asset_cu')
    expect(text).toContain('/tmp/a.mp4')
  })

  it('file hỏng phải nêu lý do', () => {
    const text = formatImportOutcome(
      outcome({ failures: [{ path: '/tmp/x.mp4', error: 'ffprobe không đọc được' }] })
    )

    expect(text).toContain('/tmp/x.mp4')
    expect(text).toContain('ffprobe không đọc được')
  })

  it('chưa mở dự án thì nói rõ, không trả về chuỗi rỗng', () => {
    expect(formatImportOutcome(null)).toContain('dự án')
  })

  it('không nhập được gì thì nói thẳng, không im lặng', () => {
    expect(formatImportOutcome(outcome())).toBe('Không nhập được file nào.')
  })
})
