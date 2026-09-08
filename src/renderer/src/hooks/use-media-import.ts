import { useCallback, useState } from 'react'
import type { EditorCommand } from '../../../shared/commands/editor-command-types'
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
}

export function useMediaImport(): {
  importing: boolean
  importPaths(filePaths: string[]): Promise<ImportOutcome | null>
  pickAndImport(): Promise<ImportOutcome | null>
} {
  const [importing, setImporting] = useState(false)
  const run = useEditorStore((state) => state.run)
  const setError = useEditorStore((state) => state.setError)

  const importPaths = useCallback(
    async (filePaths: string[]): Promise<ImportOutcome | null> => {
      const document = useEditorStore.getState().session?.document
      if (!document || filePaths.length === 0) return null

      setImporting(true)
      try {
        const result = await window.api.media.import({
          projectId: document.id,
          filePaths,
          // Gửi kèm asset hiện có để main phát hiện trùng nội dung.
          existing: document.assets
        })

        if (!result.ok) {
          setError(result.error)
          return null
        }

        const commands: EditorCommand[] = result.data.assets.map((asset) => ({
          type: 'asset/add',
          asset
        }))
        if (commands.length > 0) run(commands, 'Nhập media')

        return {
          importedCount: result.data.assets.length,
          duplicateCount: result.data.duplicates.length,
          failures: result.data.failures
        }
      } finally {
        setImporting(false)
      }
    },
    [run, setError]
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
