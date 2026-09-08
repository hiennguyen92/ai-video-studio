import { constants } from 'node:fs'
import { access, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { CURRENT_PROJECT_SCHEMA_VERSION } from '../../shared/domain/project-document-types'
import { migrateProjectDocument } from '../../shared/domain/project-document-migrations'
import {
  ensureProjectDirs,
  ensureProjectsRoot,
  projectPaths,
  projectsRoot
} from './workspace-paths'

/**
 * Đọc/ghi project ra đĩa.
 *
 * Ghi theo kiểu NGUYÊN TỬ: ghi ra file tạm rồi đổi tên đè lên file thật.
 * Nếu ghi thẳng vào project.json mà mất điện giữa chừng, người dùng mất trắng
 * cả project (DESCRIPTION §7).
 */

const MAX_VERSION_SNAPSHOTS = 20

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  createdAt: string
}

export async function saveProjectDocument(document: ProjectDocument): Promise<void> {
  const paths = await ensureProjectDirs(document.id)
  const payload = JSON.stringify(document, null, 2)
  const tempFile = `${paths.documentFile}.tmp`

  await writeFile(tempFile, payload, 'utf8')
  // rename trong cùng một filesystem là thao tác nguyên tử — hoặc file cũ, hoặc file mới,
  // không bao giờ có trạng thái ghi dở.
  await rename(tempFile, paths.documentFile)
}

export async function loadProjectDocument(projectId: string): Promise<ProjectDocument> {
  const paths = projectPaths(projectId)
  const raw = await readFile(paths.documentFile, 'utf8')
  const parsed = JSON.parse(raw) as ProjectDocument
  return migrateProjectDocument(parsed)
}

/** Lưu một bản chụp vào versions/ và dọn bớt bản cũ. */
export async function writeVersionSnapshot(document: ProjectDocument): Promise<string> {
  const paths = await ensureProjectDirs(document.id)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(paths.versionsDir, `${stamp}-rev${document.revision}.json`)
  await writeFile(file, JSON.stringify(document), 'utf8')

  const entries = (await readdir(paths.versionsDir)).filter((name) => name.endsWith('.json')).sort()
  const excess = entries.length - MAX_VERSION_SNAPSHOTS
  for (let index = 0; index < excess; index += 1) {
    await rm(join(paths.versionsDir, entries[index]), { force: true })
  }
  return file
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const root = await ensureProjectsRoot()
  const entries = await readdir(root, { withFileTypes: true })
  const summaries: ProjectSummary[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const raw = await readFile(join(root, entry.name, 'project.json'), 'utf8')
      const doc = JSON.parse(raw) as ProjectDocument
      summaries.push({
        id: doc.id,
        name: doc.name,
        updatedAt: doc.updatedAt,
        createdAt: doc.createdAt
      })
    } catch {
      // Thư mục hỏng hoặc chưa có project.json — bỏ qua, không làm gãy danh sách.
    }
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function deleteProject(projectId: string): Promise<void> {
  await rm(projectPaths(projectId).root, { recursive: true, force: true })
}

export async function projectExists(projectId: string): Promise<boolean> {
  try {
    await access(projectPaths(projectId).documentFile, constants.R_OK)
    return true
  } catch {
    return false
  }
}

export interface MissingMediaReport {
  assetId: string
  name: string
  path: string
}

/**
 * Kiểm tra media của project còn trên đĩa không (DESCRIPTION §7).
 * Chỉ so đường dẫn và kích thước — hash lại toàn bộ file lúc mở project sẽ quá chậm.
 */
export async function findMissingMedia(document: ProjectDocument): Promise<MissingMediaReport[]> {
  const missing: MissingMediaReport[] = []
  for (const asset of document.assets) {
    try {
      const stats = await stat(asset.source.path)
      if (stats.size !== asset.source.sizeBytes) {
        missing.push({ assetId: asset.id, name: asset.name, path: asset.source.path })
      }
    } catch {
      missing.push({ assetId: asset.id, name: asset.name, path: asset.source.path })
    }
  }
  return missing
}

export function currentSchemaVersion(): number {
  return CURRENT_PROJECT_SCHEMA_VERSION
}

export { projectsRoot }
