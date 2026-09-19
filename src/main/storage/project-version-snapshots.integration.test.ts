import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import {
  listVersionSnapshots,
  loadVersionSnapshot,
  writeVersionSnapshot
} from './project-version-snapshots'
import { projectPaths } from './workspace-paths'

/**
 * Bản chụp phiên bản, chạy trên thư mục THẬT: điều cần chứng minh là liệt kê
 * đọc đúng thứ đã ghi, và đường khôi phục không đọc được file nằm ngoài
 * `versions/` của đúng dự án.
 */

function project(revision: number): ProjectDocument {
  const document = createEmptyProject({ name: 'Thử phiên bản' })
  document.revision = revision
  return document
}

describe('bản chụp phiên bản', () => {
  it('liệt kê mới nhất trước, kèm lý do và tóm tắt', async () => {
    const document = project(3)
    await writeVersionSnapshot(document)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await writeVersionSnapshot({ ...document, revision: 7, name: 'Đổi tên' }, 'manual')

    const versions = await listVersionSnapshots(document.id)
    expect(versions.map((version) => [version.revision, version.reason, version.name])).toEqual([
      [7, 'manual', 'Đổi tên'],
      [3, 'auto', 'Thử phiên bản']
    ])
    expect(Date.parse(versions[0].savedAt)).not.toBeNaN()
  })

  it('khôi phục đọc lại đúng nội dung', async () => {
    const document = project(1)
    document.name = 'Bản gốc'
    await writeVersionSnapshot(document, 'before-restore')
    const [version] = await listVersionSnapshots(document.id)

    expect(version.reason).toBe('before-restore')
    expect((await loadVersionSnapshot(document.id, version.fileName)).name).toBe('Bản gốc')
  })

  it('chặn tên file trỏ ra ngoài thư mục versions', async () => {
    const document = project(1)
    await expect(loadVersionSnapshot(document.id, '../project.json')).rejects.toThrow(
      /không hợp lệ/
    )
  })

  it('chặn bản chụp của dự án khác lọt vào thư mục', async () => {
    const mine = project(1)
    const other = project(2)
    await writeVersionSnapshot(mine)
    const name = '2026-01-01T00-00-00-000Z-rev9.json'
    await writeFile(join(projectPaths(mine.id).versionsDir, name), JSON.stringify(other))

    await expect(loadVersionSnapshot(mine.id, name)).rejects.toThrow(/không thuộc dự án/)
  })

  it('bỏ qua bản chụp hỏng thay vì làm gãy cả danh sách', async () => {
    const document = project(1)
    await writeVersionSnapshot(document)
    await writeFile(
      join(projectPaths(document.id).versionsDir, '2020-01-01T00-00-00-000Z-rev1.json'),
      '{ hỏng'
    )
    expect(await listVersionSnapshots(document.id)).toHaveLength(1)
  })

  it('bản tự động không đẩy mất bản lưu tay và bản trước khi khôi phục', async () => {
    const document = project(0)
    await writeVersionSnapshot({ ...document, revision: 1 }, 'manual')
    await writeVersionSnapshot({ ...document, revision: 2 }, 'before-restore')
    for (let index = 0; index < 25; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      await writeVersionSnapshot({ ...document, revision: 10 + index })
    }
    const versions = await listVersionSnapshots(document.id)
    // Trước đây: trần chung 20 bản, bản lưu tay và bản dự phòng là hai bản cũ nhất
    // nên bị dọn trước tiên.
    expect(versions.filter((item) => item.reason === 'auto')).toHaveLength(20)
    expect(versions.some((item) => item.reason === 'manual')).toBe(true)
    expect(versions.some((item) => item.reason === 'before-restore')).toBe(true)
  })

  it('chỉ giữ 20 bản gần nhất', async () => {
    const document = project(0)
    for (let index = 0; index < 23; index += 1) {
      await writeVersionSnapshot({ ...document, revision: index })
      await new Promise((resolve) => setTimeout(resolve, 2))
    }
    const files = await readdir(projectPaths(document.id).versionsDir)
    expect(files).toHaveLength(20)
    const versions = await listVersionSnapshots(document.id)
    expect(versions.at(-1)?.revision).toBe(3)
  })
})
