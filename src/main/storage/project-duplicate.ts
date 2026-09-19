import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { createId } from '../../shared/domain/project-document-factory'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { migrateProjectDocument } from '../../shared/domain/project-document-migrations'
import { saveProjectDocument, type ProjectSummary } from './project-storage'
import { projectPaths } from './workspace-paths'

/**
 * Nhân bản một dự án: thử một hướng dựng khác mà không đụng tới bản gốc.
 *
 * Chép CẢ thư mục dự án, không chỉ project.json: giọng đã làm sạch, audio lồng
 * tiếng, thumbnail, dạng sóng đều nằm trong thư mục đó. Chỉ chép tài liệu thì bản
 * sao trỏ vào file của bản gốc — xoá bản gốc là bản sao mất tiếng mà không báo gì.
 * Vì vậy mọi đường dẫn trỏ VÀO thư mục cũ được đổi sang thư mục mới; đường dẫn
 * ra ngoài (file nguồn người dùng nhập) giữ nguyên, vì file nguồn không bao giờ
 * bị sao chép.
 *
 * Bỏ `versions/`: lịch sử phiên bản là của bản gốc, và khôi phục một bản chụp mang
 * id dự án cũ vào bản sao sẽ bị từ chối.
 */

/** Đổi mọi chuỗi bắt đầu bằng `fromRoot` thành `toRoot`, đi hết cây dữ liệu. */
export function rebaseProjectPaths<T>(value: T, fromRoot: string, toRoot: string): T {
  const prefix = fromRoot.endsWith(sep) ? fromRoot : `${fromRoot}${sep}`
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return node.startsWith(prefix) ? `${toRoot}${sep}${node.slice(prefix.length)}` : node
    }
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, walk(item)]))
    }
    return node
  }
  return walk(value) as T
}

/** Mọi file JSON dưới `dir` (kết quả job, cú máy đã dò…), đổi đường dẫn tại chỗ. */
async function rebaseJsonFiles(dir: string, fromRoot: string, toRoot: string): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await rebaseJsonFiles(path, fromRoot, toRoot)
      continue
    }
    if (!entry.name.endsWith('.json')) continue
    try {
      const data: unknown = JSON.parse(await readFile(path, 'utf8'))
      await writeFile(path, JSON.stringify(rebaseProjectPaths(data, fromRoot, toRoot)), 'utf8')
    } catch {
      // Cache hỏng: bỏ đi, nó sẽ được dựng lại — còn hơn trỏ về dự án gốc.
      await rm(path, { force: true })
    }
  }
}

export async function duplicateProject(
  projectId: string,
  nameSuffix: string
): Promise<ProjectSummary> {
  const source = projectPaths(projectId)
  const original = migrateProjectDocument(JSON.parse(await readFile(source.documentFile, 'utf8')))

  const newId = createId('proj')
  const target = projectPaths(newId)
  try {
    // KHÔNG chép project.json của bản gốc: chép hỏng giữa chừng thì thư mục mới
    // mang một project.json cùng id với bản gốc — hiện ra như dự án thứ hai, và xoá
    // nó là xoá nhầm bản gốc. Tài liệu của bản sao chỉ được ghi ở bước CUỐI.
    await cp(source.root, target.root, {
      recursive: true,
      filter: (path) =>
        path !== source.documentFile &&
        path !== `${source.documentFile}.tmp` &&
        path !== source.versionsDir &&
        !path.startsWith(`${source.versionsDir}${sep}`)
    })
    // Cache (kết quả job, cú máy đã dò) cũng ghi đường dẫn tuyệt đối vào media của
    // bản gốc; không đổi thì bản sao dùng lại file của bản gốc, xoá bản gốc là hỏng.
    await rebaseJsonFiles(target.cacheDir, source.root, target.root)

    const now = new Date().toISOString()
    const copy: ProjectDocument = {
      ...rebaseProjectPaths(original, source.root, target.root),
      id: newId,
      name: `${original.name} ${nameSuffix}`,
      createdAt: now,
      updatedAt: now,
      revision: 0
    }
    await saveProjectDocument(copy)
    return { id: copy.id, name: copy.name, createdAt: copy.createdAt, updatedAt: copy.updatedAt }
  } catch (error) {
    // Không để lại bản sao dở dang.
    await rm(target.root, { recursive: true, force: true })
    throw error
  }
}
