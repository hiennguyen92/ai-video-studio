import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { projectDurationUs } from '../../shared/domain/project-document-types'
import { migrateProjectDocument } from '../../shared/domain/project-document-migrations'
import type {
  ProjectVersionReason,
  ProjectVersionSummary
} from '../../shared/ipc/project-version-types'
import { ensureProjectDirs, projectPaths } from './workspace-paths'

/**
 * Bản chụp phiên bản của project, trong `versions/`.
 *
 * Tên file mang cả thông tin để LIỆT KÊ mà không phải mở từng file: mốc giờ (sắp
 * được theo chữ), revision, và lý do chụp. Nội dung chỉ đọc khi tóm tắt hoặc khôi
 * phục.
 */

const MAX_VERSION_SNAPSHOTS = 20

/**
 * Tên file hợp lệ: đúng dạng do `writeVersionSnapshot` sinh ra.
 *
 * Renderer gửi tên file lên để khôi phục; không kiểm thì `../../` trong tên là
 * đọc được bất cứ file JSON nào trên máy qua đường này.
 */
const SNAPSHOT_FILE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-rev(\d+)(?:-(manual|before-restore))?\.json$/

/** Chụp một bản vào `versions/`, rồi dọn bớt bản cũ nhất. */
export async function writeVersionSnapshot(
  document: ProjectDocument,
  reason: ProjectVersionReason = 'auto'
): Promise<string> {
  const paths = await ensureProjectDirs(document.id)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const suffix = reason === 'auto' ? '' : `-${reason}`
  const file = join(paths.versionsDir, `${stamp}-rev${document.revision}${suffix}.json`)
  await writeFile(file, JSON.stringify(document), 'utf8')

  const entries = (await readdir(paths.versionsDir))
    .filter((name) => SNAPSHOT_FILE.test(name))
    .sort()
  const excess = entries.length - MAX_VERSION_SNAPSHOTS
  for (let index = 0; index < excess; index += 1) {
    await rm(join(paths.versionsDir, entries[index]), { force: true })
  }
  return file
}

/** Mốc giờ trong tên file → ISO: "2026-09-19T12-30-05-123Z" → "2026-09-19T12:30:05.123Z". */
function stampToIso(stamp: string): string {
  return stamp.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
}

/**
 * Các bản chụp, mới nhất trước, kèm tóm tắt đủ để người dùng nhận ra bản nào là
 * bản nào: số clip, độ dài, tên dự án lúc đó. Bản hỏng thì bỏ qua — một file
 * dở dang không được làm gãy cả danh sách.
 */
export async function listVersionSnapshots(projectId: string): Promise<ProjectVersionSummary[]> {
  const { versionsDir } = projectPaths(projectId)
  let names: string[]
  try {
    names = await readdir(versionsDir)
  } catch {
    return []
  }

  const summaries: ProjectVersionSummary[] = []
  for (const fileName of names.sort().reverse()) {
    const match = SNAPSHOT_FILE.exec(fileName)
    if (!match) continue
    try {
      const document = JSON.parse(
        await readFile(join(versionsDir, fileName), 'utf8')
      ) as ProjectDocument
      summaries.push({
        fileName,
        savedAt: stampToIso(match[1]),
        revision: Number(match[2]),
        reason: (match[3] as ProjectVersionReason | undefined) ?? 'auto',
        name: document.name,
        clipCount: document.tracks.reduce((sum, track) => sum + track.clips.length, 0),
        durationUs: projectDurationUs(migrateProjectDocument(document))
      })
    } catch {
      // Bản chụp hỏng: bỏ qua.
    }
  }
  return summaries
}

/** Đọc một bản chụp, đã migrate lên schema hiện hành. */
export async function loadVersionSnapshot(
  projectId: string,
  fileName: string
): Promise<ProjectDocument> {
  if (!SNAPSHOT_FILE.test(fileName)) throw new Error('Tên bản chụp không hợp lệ')
  const { versionsDir } = projectPaths(projectId)
  const document = migrateProjectDocument(
    JSON.parse(await readFile(join(versionsDir, fileName), 'utf8'))
  )
  // Bản chụp của project KHÁC lọt vào thư mục này thì khôi phục sẽ ghi đè project
  // hiện tại bằng nội dung của project kia.
  if (document.id !== projectId) throw new Error('Bản chụp không thuộc dự án này')
  return document
}
