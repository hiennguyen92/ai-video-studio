import { useCallback, useState } from 'react'
import type { EditorCommand } from '../../../shared/commands/editor-command-types'
import type { MediaAsset } from '../../../shared/domain/media-asset-types'
import { useEditorStore } from '../state/editor-store'

/**
 * Nhập media vào project.
 *
 * Tiến trình main lo phần nặng (probe, hash, thumbnail, waveform); ở đây chỉ nhận
 * asset đã dựng xong rồi ghi vào document bằng lệnh `asset/add`. Nhập nhiều file
 * gộp thành MỘT bước undo, vì người dùng nghĩ về nó như một hành động duy nhất.
 */

export interface ImportOutcome {
  importedCount: number
  duplicateCount: number
  failures: Array<{ path: string; error: string }>
  /** Asset vừa nhập. Đường MCP cần chúng để trả id về cho agent. */
  assets: MediaAsset[]
  duplicates: Array<{ path: string; existingAssetId: string }>
}

/**
 * Nhập media, KHÔNG phải hook.
 *
 * Tách ra khỏi hook vì đường MCP cũng cần đúng việc này, mà chỗ đó không gọi
 * được hook: nó nằm trong một listener đăng ký một lần. Chép làm hai bản là mời
 * hai đường nhập media lệch nhau — một bên phát hiện trùng nội dung, bên kia thì
 * không.
 *
 * Đọc trạng thái tại thời điểm gọi thay vì đóng gói sẵn, để dùng được từ cả
 * listener sống lâu lẫn component.
 */
export async function importMediaPaths(filePaths: string[]): Promise<ImportOutcome | null> {
  const document = useEditorStore.getState().session?.document
  if (!document || filePaths.length === 0) return null

  const result = await window.api.media.import({
    projectId: document.id,
    filePaths,
    // Gửi kèm asset hiện có để main phát hiện trùng nội dung.
    existing: document.assets
  })
  if (!result.ok) throw new Error(result.error)

  const commands: EditorCommand[] = result.data.assets.map((asset) => ({
    type: 'asset/add',
    asset
  }))
  // Nhập nhiều file gộp thành MỘT bước undo: người dùng nghĩ về nó như một hành
  // động duy nhất.
  if (commands.length > 0) useEditorStore.getState().run(commands, 'Nhập media')

  return {
    importedCount: result.data.assets.length,
    duplicateCount: result.data.duplicates.length,
    failures: result.data.failures,
    assets: result.data.assets,
    duplicates: result.data.duplicates
  }
}

export function useMediaImport(): {
  importing: boolean
  importPaths(filePaths: string[]): Promise<ImportOutcome | null>
  pickAndImport(): Promise<ImportOutcome | null>
} {
  const [importing, setImporting] = useState(false)
  const setError = useEditorStore((state) => state.setError)

  const importPaths = useCallback(
    async (filePaths: string[]): Promise<ImportOutcome | null> => {
      setImporting(true)
      try {
        return await importMediaPaths(filePaths)
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return null
      } finally {
        setImporting(false)
      }
    },
    [setError]
  )

  const pickAndImport = useCallback(async (): Promise<ImportOutcome | null> => {
    const picked = await window.api.media.pickFiles()
    if (!picked.ok) {
      setError(picked.error)
      return null
    }
    if (picked.data.length === 0) return null
    return importPaths(picked.data)
  }, [importPaths, setError])

  return { importing, importPaths, pickAndImport }
}
