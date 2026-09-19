import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import { duplicateProject } from './project-duplicate'
import { deleteProject, loadProjectDocument, saveProjectDocument } from './project-storage'
import { writeVersionSnapshot } from './project-version-snapshots'
import { ensureProjectDirs } from './workspace-paths'

/**
 * Nhân bản dự án, trên thư mục THẬT: điều cần chứng minh là bản sao đứng được một
 * mình — xoá bản gốc đi thì bản sao vẫn còn đủ media do app sinh ra.
 */

function asset(id: string, path: string): MediaAsset {
  return {
    id,
    kind: 'audio',
    name: `${id}.flac`,
    source: { path, contentHash: id, sizeBytes: 5, mtimeMs: 0 },
    probe: { durationUs: 1_000_000, hasVideo: false, hasAudio: true },
    derived: {},
    origin: 'import',
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    missing: false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

describe('duplicateProject', () => {
  it('chép media do app sinh, đổi đường dẫn sang bản sao, giữ nguyên file nguồn bên ngoài', async () => {
    const original: ProjectDocument = createEmptyProject({ name: 'Gốc' })
    const paths = await ensureProjectDirs(original.id)
    const generated = join(paths.mediaDir, 'giong-sach.flac')
    await writeFile(generated, 'flac!')
    const waveform = join(paths.cacheDir, 'peaks.bin')
    await writeFile(waveform, 'peaks')
    const external = '/Users/ai-do/Movies/quay.mp4'

    original.assets.push(
      { ...asset('sach', generated), derived: { waveformPath: waveform } },
      asset('nguon', external)
    )
    original.revision = 42
    await saveProjectDocument(original)
    await writeVersionSnapshot(original)

    const summary = await duplicateProject(original.id, '(bản sao)')
    expect(summary.name).toBe('Gốc (bản sao)')
    expect(summary.id).not.toBe(original.id)

    const copy = await loadProjectDocument(summary.id)
    expect(copy.revision).toBe(0)
    const copiedClean = copy.assets.find((item) => item.id === 'sach')!
    expect(copiedClean.source.path).not.toBe(generated)
    expect(copiedClean.source.path).toContain(summary.id)
    expect(copiedClean.derived.waveformPath).toContain(summary.id)
    expect(copy.assets.find((item) => item.id === 'nguon')!.source.path).toBe(external)

    // Lịch sử phiên bản là của bản gốc.
    const copyRoot = join(paths.root, '..', summary.id)
    expect(await readdir(join(copyRoot, 'versions')).catch(() => [])).toEqual([])

    // Xoá bản gốc: bản sao vẫn đủ file của nó.
    await deleteProject(original.id)
    expect(await readFile(copiedClean.source.path, 'utf8')).toBe('flac!')
    expect(await exists(copiedClean.derived.waveformPath!)).toBe(true)

    await rm(copyRoot, { recursive: true, force: true })
  })
})
