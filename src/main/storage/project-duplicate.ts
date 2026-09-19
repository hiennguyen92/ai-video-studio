import { cp, readFile } from 'node:fs/promises'
import { sep } from 'node:path'
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

export async function duplicateProject(
  projectId: string,
  nameSuffix: string
): Promise<ProjectSummary> {
  const source = projectPaths(projectId)
  const original = migrateProjectDocument(JSON.parse(await readFile(source.documentFile, 'utf8')))

  const newId = createId('proj')
  const target = projectPaths(newId)
  await cp(source.root, target.root, {
    recursive: true,
    filter: (path) => path !== source.versionsDir && !path.startsWith(`${source.versionsDir}${sep}`)
  })

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
}
