import { storeFontForBurnIn } from '../storage/font-store'
import { removeProjectGarbage, scanProjectGarbage } from '../storage/project-garbage-service'
import { app, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { MediaAsset } from '../../shared/domain/media-asset-types'
import type { ProjectDocument } from '../../shared/domain/project-document-types'
import { createEmptyProject } from '../../shared/domain/project-document-factory'
import {
  IPC,
  type CreateProjectRequest,
  type ImportMediaRequest,
  type ExportRequest,
  type ImportMediaResponse,
  type IpcResult,
  type WaveformData
} from '../../shared/ipc/ipc-contract'
import {
  deleteProject,
  findMissingMedia,
  listProjects,
  loadProjectDocument,
  saveProjectDocument,
  writeVersionSnapshot
} from '../storage/project-storage'
import { importMediaFile, relinkMediaAsset } from '../media/media-import-service'
import {
  availableSoundEffectIds,
  buildSoundEffectAsset,
  repairBuiltinAssetPaths
} from '../media/sound-effect-library'
import { cancelExport, detectExportCapabilities, runExport } from '../export/export-manager'
import { defaultExportDir } from '../storage/workspace-paths'

/**
 * Đăng ký handler IPC.
 *
 * Mọi handler đều trả `IpcResult` thay vì ném lỗi: một lỗi ném qua ranh giới IPC
 * chỉ còn lại chuỗi thông báo mất ngữ cảnh, và renderer sẽ khó hiển thị đúng.
 */

const MEDIA_FILE_FILTERS = [
  {
    name: 'Media',
    extensions: [
      'mp4',
      'mov',
      'mkv',
      'webm',
      'avi',
      'm4v',
      'mp3',
      'wav',
      'm4a',
      'aac',
      'flac',
      'ogg',
      'png',
      'jpg',
      'jpeg',
      'webp',
      'gif'
    ]
  },
  { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] },
  { name: 'Âm thanh', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] },
  { name: 'Hình ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }
]

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function guard<T>(work: () => Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await work() }
  } catch (error) {
    return { ok: false, error: toErrorMessage(error) }
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IPC.projectList, () => guard(() => listProjects()))

  ipcMain.handle(IPC.projectCreate, (_event, request: CreateProjectRequest) =>
    guard(async () => {
      const document = createEmptyProject({
        name: request.name,
        aspectRatio: request.aspectRatio
      })
      await saveProjectDocument(document)
      return document
    })
  )

  ipcMain.handle(IPC.projectLoad, (_event, projectId: string) =>
    guard(async () => {
      const document = await loadProjectDocument(projectId)
      // Trỏ lại đường dẫn hiệu ứng dựng sẵn TRƯỚC khi renderer dò media thiếu.
      // Dự án lưu id chứ không lưu đường dẫn, và đường dẫn cũ thuộc về bản cài
      // trước — mở bản mới mà không trỏ lại thì báo thiếu media cho những thứ
      // đang nằm ngay trong app.
      repairBuiltinAssetPaths(document.assets)
      return document
    })
  )

  ipcMain.handle(IPC.soundEffectsList, () => guard(async () => availableSoundEffectIds()))

  ipcMain.handle(IPC.soundEffectsBuildAsset, (_event, id: string) =>
    guard(() => buildSoundEffectAsset(id))
  )

  ipcMain.handle(IPC.projectSave, (_event, document: ProjectDocument) =>
    guard(() => saveProjectDocument(document))
  )

  ipcMain.handle(IPC.projectDelete, (_event, projectId: string) =>
    guard(() => deleteProject(projectId))
  )

  ipcMain.handle(IPC.fontStore, (_event, family: string, bytes: Uint8Array) =>
    guard(() => storeFontForBurnIn(family, bytes))
  )

  ipcMain.handle(IPC.projectScanGarbage, (_event, document: ProjectDocument) =>
    guard(() => scanProjectGarbage(document.id, document))
  )

  ipcMain.handle(IPC.projectRemoveGarbage, (_event, document: ProjectDocument) =>
    guard(() => removeProjectGarbage(document.id, document))
  )

  ipcMain.handle(IPC.projectSnapshot, (_event, document: ProjectDocument) =>
    guard(() => writeVersionSnapshot(document))
  )

  ipcMain.handle(IPC.projectCheckMedia, (_event, document: ProjectDocument) =>
    guard(() => findMissingMedia(document))
  )

  ipcMain.handle(IPC.mediaPickFiles, () =>
    guard(async () => {
      const result = await dialog.showOpenDialog({
        title: 'Chọn media để import',
        properties: ['openFile', 'multiSelections'],
        filters: MEDIA_FILE_FILTERS
      })
      return result.canceled ? [] : result.filePaths
    })
  )

  ipcMain.handle(IPC.mediaImport, (_event, request: ImportMediaRequest) =>
    guard(async () => {
      const response: ImportMediaResponse = { assets: [], duplicates: [], failures: [] }
      // Tích luỹ dần để hai file giống nhau trong CÙNG một lần import cũng bị bắt trùng.
      const known = [...(request.existing ?? [])]

      for (const filePath of request.filePaths) {
        try {
          const result = await importMediaFile({ projectId: request.projectId, filePath }, known)
          if (result.duplicateOfAssetId) {
            response.duplicates.push({ path: filePath, existingAssetId: result.duplicateOfAssetId })
          } else {
            response.assets.push(result.asset)
            known.push(result.asset)
          }
        } catch (error) {
          response.failures.push({ path: filePath, error: toErrorMessage(error) })
        }
      }
      return response
    })
  )

  ipcMain.handle(IPC.mediaRelink, (_event, asset: MediaAsset, newPath: string) =>
    guard(() => relinkMediaAsset(asset, newPath))
  )

  ipcMain.handle(IPC.mediaReadWaveform, (_event, waveformPath: string) =>
    guard(async () => {
      const buffer = await readFile(waveformPath)
      const peaks: number[] = new Array(buffer.length / 2)
      for (let index = 0; index * 2 < buffer.length; index += 1) {
        peaks[index] = buffer.readInt16LE(index * 2) / 32768
      }
      const data: WaveformData = { bucketsPerSecond: 100, peaks }
      return data
    })
  )

  ipcMain.handle(IPC.exportCapabilities, () => guard(() => detectExportCapabilities()))

  ipcMain.handle(IPC.exportPickPath, (_event, defaultFileName: string) =>
    guard(async () => {
      const result = await dialog.showSaveDialog({
        title: 'Chọn nơi lưu video',
        defaultPath: join(defaultExportDir(), defaultFileName),
        filters: [{ name: 'Video MP4', extensions: ['mp4'] }]
      })
      return result.canceled || !result.filePath ? null : result.filePath
    })
  )

  ipcMain.handle(IPC.exportStart, (event, request: ExportRequest) =>
    guard(() => runExport(event.sender, request))
  )

  ipcMain.handle(IPC.exportCancel, (_event, jobId: string) =>
    guard(async () => {
      cancelExport(jobId)
    })
  )

  ipcMain.handle(IPC.appInfo, () =>
    guard(async () => ({
      version: app.getVersion(),
      platform: process.platform,
      locale: app.getLocale(),
      userDataPath: app.getPath('userData')
    }))
  )
}
