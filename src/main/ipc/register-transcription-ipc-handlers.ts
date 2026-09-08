import { ipcMain, type WebContents } from 'electron'
import type {
  IpcResult,
  TranscribeIpcRequest,
  WhisperDownloadProgressEvent,
  WhisperModelDto
} from '../../shared/ipc/ipc-contract'
import { IPC, IPC_EVENT } from '../../shared/ipc/ipc-contract'
import { ProviderError } from '../../shared/ai/ai-provider-contracts'
import { enqueueTranscription, readTranscriptionResult } from '../ai/transcription-service'
import {
  WHISPER_MODELS,
  deleteWhisperModel,
  downloadWhisperModel,
  listDownloadedModels,
  type DownloadHandle
} from '../ai/whisper-model-downloader'

/**
 * Handler IPC cho phiên âm và quản lý model whisper.
 *
 * Tải model được đẩy tiến trình về renderer theo sự kiện thay vì để renderer hỏi
 * liên tục: file 1,5 GB tải mất vài phút, và người dùng cần thấy nó đang nhúc nhích.
 */

function toErrorMessage(error: unknown): string {
  if (error instanceof ProviderError) return error.message
  return error instanceof Error ? error.message : String(error)
}

async function guard<T>(work: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await work() }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

/** Các lượt tải đang chạy, để huỷ được đúng model. */
const activeDownloads = new Map<string, DownloadHandle>()

function emitDownload(sender: WebContents, event: WhisperDownloadProgressEvent): void {
  if (!sender.isDestroyed()) sender.send(IPC_EVENT.whisperDownloadProgress, event)
}

export function registerTranscriptionIpcHandlers(): void {
  ipcMain.handle(IPC.sttTranscribe, (_event, request: TranscribeIpcRequest) =>
    guard(() => enqueueTranscription(request))
  )

  ipcMain.handle(IPC.sttReadResult, (_event, jobId: string) =>
    guard(() => readTranscriptionResult(jobId))
  )

  ipcMain.handle(IPC.whisperListModels, () =>
    guard(async () => {
      const downloaded = await listDownloadedModels()
      const models: WhisperModelDto[] = WHISPER_MODELS.map((model) => {
        const match = downloaded.find((item) => item.id === model.id)
        return {
          id: model.id,
          fileName: model.fileName,
          approximateBytes: model.approximateBytes,
          labelVi: model.labelVi,
          labelEn: model.labelEn,
          vietnameseQuality: model.vietnameseQuality,
          downloaded: Boolean(match),
          path: match?.path
        }
      })
      return models
    })
  )

  ipcMain.handle(IPC.whisperDownload, (event, modelId: string) =>
    guard(async () => {
      if (activeDownloads.has(modelId)) return

      const handle = downloadWhisperModel(modelId, (progress) => {
        emitDownload(event.sender, {
          modelId,
          status: 'running',
          receivedBytes: progress.receivedBytes,
          totalBytes: progress.totalBytes,
          ratio: progress.ratio
        })
      })
      activeDownloads.set(modelId, handle)

      void handle.done
        .then((path) => {
          emitDownload(event.sender, {
            modelId,
            status: 'succeeded',
            receivedBytes: 0,
            ratio: 1,
            path
          })
        })
        .catch((error: unknown) => {
          const message = toErrorMessage(error)
          emitDownload(event.sender, {
            modelId,
            // Người dùng chủ động huỷ không phải là lỗi.
            status: message.includes('huỷ') ? 'cancelled' : 'failed',
            receivedBytes: 0,
            error: message
          })
        })
        .finally(() => activeDownloads.delete(modelId))
    })
  )

  ipcMain.handle(IPC.whisperCancelDownload, (_event, modelId: string) =>
    guard(async () => {
      activeDownloads.get(modelId)?.cancel()
    })
  )

  ipcMain.handle(IPC.whisperDeleteModel, (_event, modelId: string) =>
    guard(() => deleteWhisperModel(modelId))
  )
}

/** Dừng mọi lượt tải khi thoát, tránh để lại file .part mồ côi. */
export function cancelAllModelDownloads(): void {
  for (const handle of activeDownloads.values()) handle.cancel()
  activeDownloads.clear()
}
