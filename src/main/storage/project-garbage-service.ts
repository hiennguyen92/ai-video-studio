import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { projectPaths } from './workspace-paths'
import { pruneMissingCacheEntries } from '../jobs/job-result-cache'
import {
  selectProjectGarbage,
  totalBytes,
  type GarbageSelection,
  type ProjectFileEntry
} from './project-garbage-selector'

/**
 * Quét và dọn file do ứng dụng sinh ra mà không còn ai dùng.
 *
 * Chạy theo YÊU CẦU chứ không tự động: dọn ngầm mỗi lần lưu nghĩa là một lỗi
 * trong phần chọn file sẽ âm thầm ăn mất dữ liệu suốt nhiều phiên trước khi có
 * ai nhận ra. Người dùng bấm, thấy con số, rồi mới xoá.
 *
 * Không bao giờ đụng tới file người dùng nhập vào: nhập media không sao chép,
 * `source.path` trỏ ra ngoài thư mục dự án nên nó không nằm trong vùng quét.
 */

export interface GarbageReport {
  fileCount: number
  totalBytes: number
}

/** Mọi đường dẫn mà asset đang trỏ tới, kể cả file phái sinh. */
function referencedPaths(document: ProjectDocument): string[] {
  const paths: string[] = []
  for (const asset of document.assets) {
    paths.push(asset.source.path)
    const { thumbnailPath, filmstripPath, waveformPath, shotsPath } = asset.derived
    for (const path of [thumbnailPath, filmstripPath, waveformPath, shotsPath]) {
      if (path) paths.push(path)
    }
  }
  return paths
}

async function listDirectory(directory: string): Promise<ProjectFileEntry[]> {
  let names: string[]
  try {
    names = await readdir(directory)
  } catch {
    // Thư mục chưa từng được tạo — coi như rỗng.
    return []
  }

  const entries: ProjectFileEntry[] = []
  for (const name of names) {
    const path = join(directory, name)
    try {
      const stats = await stat(path)
      // Thư mục con (ảnh cú máy) tính theo tổng dung lượng bên trong.
      const sizeBytes = stats.isDirectory() ? await directorySize(path) : stats.size
      entries.push({ path, name, sizeBytes })
    } catch {
      // File biến mất giữa chừng thì bỏ qua; nó không còn là rác nữa.
    }
  }
  return entries
}

async function directorySize(directory: string): Promise<number> {
  let total = 0
  for (const entry of await listDirectory(directory)) total += entry.sizeBytes
  return total
}

async function scan(projectId: string, document: ProjectDocument): Promise<GarbageSelection> {
  const paths = projectPaths(projectId)

  return selectProjectGarbage({
    mediaFiles: await listDirectory(paths.mediaDir),
    cacheEntries: await listDirectory(paths.cacheDir),
    referencedPaths: referencedPaths(document),
    liveAssetIds: document.assets.map((asset) => asset.id)
  })
}

/** Đếm trước, chưa xoá gì — để giao diện hỏi người dùng bằng con số thật. */
export async function scanProjectGarbage(
  projectId: string,
  document: ProjectDocument
): Promise<GarbageReport> {
  const selection = await scan(projectId, document)

  return {
    fileCount: selection.media.length + selection.cache.length,
    totalBytes: totalBytes(selection)
  }
}

/**
 * Xoá thật.
 *
 * Quét LẠI thay vì nhận danh sách từ giao diện: giữa lúc hỏi và lúc bấm đồng ý,
 * một job có thể vừa sinh xong một file mới, và xoá theo danh sách cũ sẽ giết nó.
 */
export async function removeProjectGarbage(
  projectId: string,
  document: ProjectDocument
): Promise<GarbageReport> {
  const selection = await scan(projectId, document)
  const removed: ProjectFileEntry[] = []

  for (const entry of [...selection.media, ...selection.cache]) {
    try {
      await rm(entry.path, { recursive: true, force: true })
      removed.push(entry)
    } catch {
      // File đang bị khoá hoặc vừa bị xoá — báo đúng phần dọn được, không ngã.
    }
  }

  // Chỉ mục dùng lại kết quả vẫn trỏ tới file vừa xoá. Nó tự lành khi tra không
  // thấy file, nhưng dọn ngay thì nó khỏi phình lên theo từng lần dọn rác.
  await pruneMissingCacheEntries(projectId)

  return {
    fileCount: removed.length,
    totalBytes: removed.reduce((total, entry) => total + entry.sizeBytes, 0)
  }
}
