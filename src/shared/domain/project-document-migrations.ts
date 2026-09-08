import { CURRENT_PROJECT_SCHEMA_VERSION, type ProjectDocument } from './project-document-types'
import { createDefaultAiSettings } from './ai-settings-types'

/**
 * Nâng cấp project cũ lên schema hiện hành.
 *
 * Quy ước: mỗi bước migrate là một hàm `vN -> vN+1`, chạy tuần tự. Không sửa
 * bước cũ khi thêm bước mới — project của người dùng đã đi qua bước cũ rồi.
 *
 * Khi thêm trường mới KHÔNG phá vỡ tương thích, chỉ cần điền mặc định trong
 * `fillDefaults` và không cần tăng schemaVersion.
 */

type MigrationStep = (doc: Record<string, unknown>) => Record<string, unknown>

/**
 * Chưa có bước nào vì schema đang ở v1 — bản phát hành đầu tiên.
 * Ví dụ khi lên v2:  1: (doc) => ({ ...doc, schemaVersion: 2, newField: [] })
 */
const MIGRATIONS: Record<number, MigrationStep> = {}

export class ProjectSchemaTooNewError extends Error {
  constructor(fileVersion: number) {
    super(
      `Project được tạo bởi phiên bản mới hơn (schema v${fileVersion}, ứng dụng hỗ trợ tối đa v${CURRENT_PROJECT_SCHEMA_VERSION}). Hãy cập nhật AI Video Studio.`
    )
    this.name = 'ProjectSchemaTooNewError'
  }
}

/** Điền mặc định cho các trường được thêm mà không phá tương thích. */
function fillDefaults(doc: Record<string, unknown>): ProjectDocument {
  const filled = doc as unknown as ProjectDocument
  filled.assets ??= []
  filled.tracks ??= []
  filled.transcripts ??= []
  filled.translations ??= []
  filled.dubbingSessions ??= []
  filled.subtitleTracks ??= []
  filled.aiSettings ??= createDefaultAiSettings()
  filled.revision ??= 0
  return filled
}

export function migrateProjectDocument(raw: unknown): ProjectDocument {
  if (!raw || typeof raw !== 'object') {
    throw new Error('File project không hợp lệ: không phải đối tượng JSON.')
  }

  let doc = raw as Record<string, unknown>
  const fileVersion = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : 1

  if (fileVersion > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new ProjectSchemaTooNewError(fileVersion)
  }

  for (let version = fileVersion; version < CURRENT_PROJECT_SCHEMA_VERSION; version += 1) {
    const step = MIGRATIONS[version]
    if (!step) {
      throw new Error(`Thiếu bước nâng cấp schema từ v${version} lên v${version + 1}.`)
    }
    doc = step(doc)
  }

  doc.schemaVersion = CURRENT_PROJECT_SCHEMA_VERSION
  return fillDefaults(doc)
}
