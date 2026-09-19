import { useCallback, useState } from 'react'
import type { MissingMediaReport } from '../../../shared/ipc/ipc-contract'
import { selectDocument, useEditorStore } from '../state/editor-store'

/**
 * Trỏ một media bị thiếu sang file mới.
 *
 * Phần nặng đã có sẵn từ lâu ở tiến trình main — `relinkMediaAsset` probe lại
 * file, tính lại hash, và GIỮ NGUYÊN id nên mọi clip đang dùng asset vẫn chạy.
 * Thiếu đúng chỗ này: không có đường nào từ giao diện gọi tới nó, nên đổi tên
 * một thư mục là dự án hỏng vĩnh viễn dù mã nối lại đã viết xong.
 *
 * Người dùng chọn TỪNG file một, không phải chọn cả thư mục: hai media khác nhau
 * có thể cùng tên, và đoán sai thì clip trỏ sang nhầm cảnh quay — kiểu hỏng chỉ
 * lộ ra lúc xem lại bản dựng.
 */
export function useMediaRelink(): {
  relinking: string | null
  relink(report: MissingMediaReport): Promise<boolean>
} {
  const [relinking, setRelinking] = useState<string | null>(null)
  const setError = useEditorStore((state) => state.setError)

  const relink = useCallback(
    async (report: MissingMediaReport): Promise<boolean> => {
      const document = selectDocument(useEditorStore.getState())
      const asset = document?.assets.find((item) => item.id === report.assetId)
      if (!asset) return false

      const picked = await window.api.media.pickFiles()
      if (!picked.ok) {
        setError(picked.error)
        return false
      }
      // Người dùng bấm Huỷ trong hộp chọn file: im lặng, không phải lỗi.
      if (picked.data.length === 0) return false

      setRelinking(report.assetId)
      try {
        const result = await window.api.media.relink(asset, picked.data[0])
        if (!result.ok) {
          setError(result.error)
          return false
        }
        return useEditorStore
          .getState()
          .run([{ type: 'asset/relink', asset: result.data }], 'Nối lại media')
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        setRelinking(null)
      }
    },
    [setError]
  )

  return { relinking, relink }
}
