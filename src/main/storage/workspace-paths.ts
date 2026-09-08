import { app } from 'electron'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Bố cục thư mục dữ liệu người dùng.
 *
 * <userData>/projects/<project-id>/
 *   project.json      tài liệu project
 *   media/            media đã import và media do AI tạo
 *   cache/            thumbnail, filmstrip, waveform, kết quả job (xoá được)
 *   versions/         bản autosave để mở lại khi hỏng
 *
 * Media do AI tạo nằm CÙNG CHỖ với media import, vì với phần còn lại của ứng dụng
 * chúng không khác gì nhau (DESCRIPTION §4).
 */

export interface ProjectPaths {
  root: string
  documentFile: string
  mediaDir: string
  cacheDir: string
  versionsDir: string
}

export function projectsRoot(): string {
  return join(app.getPath('userData'), 'projects')
}

export function projectPaths(projectId: string): ProjectPaths {
  const root = join(projectsRoot(), projectId)
  return {
    root,
    documentFile: join(root, 'project.json'),
    mediaDir: join(root, 'media'),
    cacheDir: join(root, 'cache'),
    versionsDir: join(root, 'versions')
  }
}

export async function ensureProjectDirs(projectId: string): Promise<ProjectPaths> {
  const paths = projectPaths(projectId)
  await mkdir(paths.mediaDir, { recursive: true })
  await mkdir(paths.cacheDir, { recursive: true })
  await mkdir(paths.versionsDir, { recursive: true })
  return paths
}

export async function ensureProjectsRoot(): Promise<string> {
  const root = projectsRoot()
  await mkdir(root, { recursive: true })
  return root
}

/** Nơi ghi file export mặc định. */
export function defaultExportDir(): string {
  return app.getPath('videos')
}
