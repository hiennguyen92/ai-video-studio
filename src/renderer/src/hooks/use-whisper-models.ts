import { useCallback, useEffect, useState } from 'react'
import type {
  WhisperDownloadProgressEvent,
  WhisperModelDto
} from '../../../shared/ipc/ipc-contract'

/**
 * Quản lý model whisper: liệt kê, tải về, huỷ tải, xoá.
 *
 * Model nặng từ 150 MB tới 3 GB nên tiến trình tải phải hiện được và huỷ được;
 * bắt người dùng ngồi chờ một thanh không nhúc nhích vài phút là không chấp nhận được.
 */

export interface ModelDownloadState {
  status: 'idle' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  receivedBytes: number
  totalBytes?: number
  ratio?: number
  error?: string
}

export function useWhisperModels(): {
  models: WhisperModelDto[]
  downloads: Record<string, ModelDownloadState>
  refresh(): Promise<void>
  download(modelId: string): Promise<void>
  cancelDownload(modelId: string): Promise<void>
  deleteModel(modelId: string): Promise<void>
} {
  const [models, setModels] = useState<WhisperModelDto[]>([])
  const [downloads, setDownloads] = useState<Record<string, ModelDownloadState>>({})

  const refresh = useCallback(async () => {
    const result = await window.api.whisper.listModels()
    if (result.ok) setModels(result.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await window.api.whisper.listModels()
      if (!cancelled && result.ok) setModels(result.data)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return window.api.whisper.onDownloadProgress((event: WhisperDownloadProgressEvent) => {
      setDownloads((current) => ({
        ...current,
        [event.modelId]: {
          status: event.status,
          receivedBytes: event.receivedBytes,
          totalBytes: event.totalBytes,
          ratio: event.ratio,
          error: event.error
        }
      }))
      // Tải xong thì danh sách model phải cập nhật để nút đổi sang "Dùng model này".
      if (event.status === 'succeeded') void refresh()
    })
  }, [refresh])

  const download = useCallback(async (modelId: string) => {
    setDownloads((current) => ({
      ...current,
      [modelId]: { status: 'running', receivedBytes: 0 }
    }))
    await window.api.whisper.download(modelId)
  }, [])

  const cancelDownload = useCallback(async (modelId: string) => {
    await window.api.whisper.cancelDownload(modelId)
  }, [])

  const deleteModel = useCallback(
    async (modelId: string) => {
      await window.api.whisper.deleteModel(modelId)
      setDownloads((current) => {
        const next = { ...current }
        delete next[modelId]
        return next
      })
      await refresh()
    },
    [refresh]
  )

  return { models, downloads, refresh, download, cancelDownload, deleteModel }
}

/** Đổi byte sang chuỗi dễ đọc, dùng cho cả kích thước model lẫn tiến trình tải. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`
  return `${Math.round(bytes / 1000)} KB`
}
