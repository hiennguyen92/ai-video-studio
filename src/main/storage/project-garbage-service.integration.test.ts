import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { computeRequestFingerprint, rememberResult } from '../jobs/job-result-cache'
import { ensureProjectDirs, projectPaths } from './workspace-paths'
import { removeProjectGarbage, scanProjectGarbage } from './project-garbage-service'

/**
 * Dọn rác, chạy trên thư mục THẬT.
 *
 * Phần chọn file đã có test thuần riêng. Ở đây kiểm thứ test thuần không kiểm
 * nổi: file nào thật sự biến mất khỏi đĩa và file nào thật sự còn lại. Đây là
 * thao tác không hoàn tác được, nên phải nhìn tận đĩa mới yên tâm.
 */

let projectId = ''
let document: ProjectDocument

function asset(id: string, path: string, derived: MediaAsset['derived'] = {}): MediaAsset {
  return {
    id,
    kind: 'audio',
    name: 'giọng đọc.mp3',
    source: { path, contentHash: 'h', sizeBytes: 1, mtimeMs: 0 },
    probe: { durationUs: 1_000_000, hasVideo: false, hasAudio: true },
    derived,
    origin: 'generated',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

let counter = 0

beforeEach(async () => {
  counter += 1
  document = createEmptyProject({ name: `Dọn rác ${counter}` })
  projectId = document.id
  await ensureProjectDirs(projectId)
})

describe('dọn rác trên đĩa thật', () => {
  it('xoá file media không ai dùng, giữ file đang được asset trỏ tới', async () => {
    const paths = projectPaths(projectId)
    const keep = join(paths.mediaDir, 'giong-doc-dang-dung.mp3')
    const drop = join(paths.mediaDir, 'giong-doc-cu.mp3')
    await writeFile(keep, 'A'.repeat(500))
    await writeFile(drop, 'B'.repeat(1500))

    document.assets.push(asset('asset_song', keep))

    const scan = await scanProjectGarbage(projectId, document)
    expect(scan.fileCount).toBe(1)
    expect(scan.totalBytes).toBe(1500)

    const removed = await removeProjectGarbage(projectId, document)
    expect(removed.fileCount).toBe(1)

    await expect(access(keep)).resolves.toBeUndefined()
    await expect(access(drop)).rejects.toThrow()
  })

  it('xoá file cache của asset đã mất, giữ file cache của asset còn sống', async () => {
    const paths = projectPaths(projectId)
    const liveThumb = join(paths.cacheDir, 'asset_song-thumb.jpg')
    const deadThumb = join(paths.cacheDir, 'asset_chet-thumb.jpg')
    const deadShots = join(paths.cacheDir, 'shots-asset_chet')
    await writeFile(liveThumb, 'x'.repeat(100))
    await writeFile(deadThumb, 'x'.repeat(100))
    await mkdir(deadShots, { recursive: true })
    await writeFile(join(deadShots, 'shot-000.jpg'), 'x'.repeat(300))

    document.assets.push(
      asset('asset_song', join(paths.mediaDir, 'khong-can-ton-tai.mp3'), {
        thumbnailPath: liveThumb
      })
    )

    await removeProjectGarbage(projectId, document)

    await expect(access(liveThumb)).resolves.toBeUndefined()
    await expect(access(deadThumb)).rejects.toThrow()
    // Thư mục ảnh cú máy phải bị xoá cả cụm, không để lại thư mục rỗng.
    await expect(access(deadShots)).rejects.toThrow()
  })

  it('KHÔNG đụng tới chỉ mục dùng lại kết quả', async () => {
    const paths = projectPaths(projectId)
    const kept = join(paths.mediaDir, 'con-dung.mp3')
    await writeFile(kept, 'x')
    document.assets.push(asset('asset_song', kept))

    await rememberResult(projectId, {
      fingerprint: computeRequestFingerprint({ text: 'xin chào' }),
      path: kept,
      providerId: 'test',
      model: 'test'
    })

    await removeProjectGarbage(projectId, document)

    const index = JSON.parse(await readFile(join(paths.cacheDir, 'job-results.json'), 'utf8'))
    expect(Object.keys(index)).toHaveLength(1)
  })

  it('bỏ khỏi chỉ mục những mục trỏ tới file vừa bị xoá', async () => {
    const paths = projectPaths(projectId)
    const orphan = join(paths.mediaDir, 'khong-ai-dung.mp3')
    await writeFile(orphan, 'x'.repeat(50))

    await rememberResult(projectId, {
      fingerprint: computeRequestFingerprint({ text: 'câu cũ' }),
      path: orphan,
      providerId: 'test',
      model: 'test'
    })

    await removeProjectGarbage(projectId, document)

    // Mục trỏ tới file đã mất mà nằm lại thì chỉ mục phình lên sau mỗi lần dọn.
    const index = JSON.parse(await readFile(join(paths.cacheDir, 'job-results.json'), 'utf8'))
    expect(Object.keys(index)).toHaveLength(0)
  })

  it('không có gì để dọn thì báo 0 và không xoá gì', async () => {
    const paths = projectPaths(projectId)
    const kept = join(paths.mediaDir, 'con-dung.mp3')
    await writeFile(kept, 'x')
    document.assets.push(asset('asset_song', kept))

    expect((await scanProjectGarbage(projectId, document)).fileCount).toBe(0)
    expect((await removeProjectGarbage(projectId, document)).fileCount).toBe(0)
    await expect(access(kept)).resolves.toBeUndefined()
  })

  it('quét lại lần hai không còn gì, tức là dọn đã thật sự xoá', async () => {
    await writeFile(join(projectPaths(projectId).mediaDir, 'rac.mp3'), 'x'.repeat(10))

    expect((await scanProjectGarbage(projectId, document)).fileCount).toBe(1)
    await removeProjectGarbage(projectId, document)
    expect((await scanProjectGarbage(projectId, document)).fileCount).toBe(0)
  })
})
