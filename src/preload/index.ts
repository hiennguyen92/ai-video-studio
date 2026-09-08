import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  IPC_EVENT,
  type ExportProgressEvent,
  type RendererApi
} from '../shared/ipc/ipc-contract'
import type { JobRecord } from '../shared/jobs/job-types'
import type { WhisperDownloadProgressEvent } from '../shared/ipc/ipc-contract'

/**
 * Cầu nối duy nhất giữa renderer và main.
 *
 * Chỉ những hàm liệt kê ở đây mới tới được renderer. Không expose `ipcRenderer`
 * thô: làm vậy là mở cho mọi mã chạy trong trang gọi bất kỳ kênh IPC nào.
 *
 * File này chỉ được phép import `electron` và mã nguồn nội bộ. Preload chạy trong
 * sandbox nên KHÔNG resolve được package từ node_modules — mọi thư viện ngoài sẽ
 * ném lỗi lúc nạp, `window.api` không bao giờ xuất hiện, và renderer chết lặng.
 */

const api: RendererApi = {
  project: {
    list: () => ipcRenderer.invoke(IPC.projectList),
    create: (request) => ipcRenderer.invoke(IPC.projectCreate, request),
    load: (projectId) => ipcRenderer.invoke(IPC.projectLoad, projectId),
    save: (document) => ipcRenderer.invoke(IPC.projectSave, document),
    remove: (projectId) => ipcRenderer.invoke(IPC.projectDelete, projectId),
    snapshot: (document) => ipcRenderer.invoke(IPC.projectSnapshot, document),
    checkMedia: (document) => ipcRenderer.invoke(IPC.projectCheckMedia, document)
  },
  media: {
    pickFiles: () => ipcRenderer.invoke(IPC.mediaPickFiles),
    import: (request) => ipcRenderer.invoke(IPC.mediaImport, request),
    relink: (asset, newPath) => ipcRenderer.invoke(IPC.mediaRelink, asset, newPath),
    readWaveform: (waveformPath) => ipcRenderer.invoke(IPC.mediaReadWaveform, waveformPath)
  },
  ai: {
    settings: () => ipcRenderer.invoke(IPC.aiProviders),
    setCredential: (providerId, apiKey) =>
      ipcRenderer.invoke(IPC.aiSetCredential, providerId, apiKey),
    setConfig: (providerId, config) => ipcRenderer.invoke(IPC.aiSetConfig, providerId, config),
    deleteCredential: (providerId) => ipcRenderer.invoke(IPC.aiDeleteCredential, providerId),
    testConnection: (providerId) => ipcRenderer.invoke(IPC.aiTestConnection, providerId),
    listModels: (providerId) => ipcRenderer.invoke(IPC.aiListModels, providerId),
    listVoices: (request) => ipcRenderer.invoke(IPC.aiListVoices, request),
    capabilities: (providerId, model) => ipcRenderer.invoke(IPC.aiCapabilities, providerId, model),
    generateSpeech: (request) => ipcRenderer.invoke(IPC.aiGenerateSpeech, request),
    attachGeneratedAudio: (request) => ipcRenderer.invoke(IPC.aiAttachGeneratedAudio, request)
  },
  stt: {
    transcribe: (request) => ipcRenderer.invoke(IPC.sttTranscribe, request),
    readResult: (jobId) => ipcRenderer.invoke(IPC.sttReadResult, jobId)
  },
  translate: {
    run: (request) => ipcRenderer.invoke(IPC.translateRun, request),
    readResult: (jobId) => ipcRenderer.invoke(IPC.translateReadResult, jobId)
  },
  whisper: {
    listModels: () => ipcRenderer.invoke(IPC.whisperListModels),
    download: (modelId) => ipcRenderer.invoke(IPC.whisperDownload, modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke(IPC.whisperCancelDownload, modelId),
    deleteModel: (modelId) => ipcRenderer.invoke(IPC.whisperDeleteModel, modelId),
    onDownloadProgress: (listener) => {
      const handler = (_event: unknown, payload: WhisperDownloadProgressEvent): void =>
        listener(payload)
      ipcRenderer.on(IPC_EVENT.whisperDownloadProgress, handler)
      return () => ipcRenderer.removeListener(IPC_EVENT.whisperDownloadProgress, handler)
    }
  },
  jobs: {
    list: (projectId) => ipcRenderer.invoke(IPC.jobList, projectId),
    cancel: (jobId) => ipcRenderer.invoke(IPC.jobCancel, jobId),
    clearFinished: (projectId) => ipcRenderer.invoke(IPC.jobClearFinished, projectId),
    onChanged: (listener) => {
      const handler = (_event: unknown, payload: { job: JobRecord }): void => listener(payload.job)
      ipcRenderer.on(IPC_EVENT.jobChanged, handler)
      return () => ipcRenderer.removeListener(IPC_EVENT.jobChanged, handler)
    }
  },
  export: {
    capabilities: () => ipcRenderer.invoke(IPC.exportCapabilities),
    pickOutputPath: (defaultFileName) => ipcRenderer.invoke(IPC.exportPickPath, defaultFileName),
    start: (request) => ipcRenderer.invoke(IPC.exportStart, request),
    cancel: (jobId) => ipcRenderer.invoke(IPC.exportCancel, jobId),
    onProgress: (listener) => {
      // Bọc lại để renderer không chạm được vào đối tượng `event` của Electron.
      const handler = (_event: unknown, payload: ExportProgressEvent): void => listener(payload)
      ipcRenderer.on(IPC_EVENT.exportProgress, handler)
      return () => ipcRenderer.removeListener(IPC_EVENT.exportProgress, handler)
    }
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  // Đồng bộ vì bố cục cần biết ngay lúc render đầu tiên (chừa chỗ nút đèn giao
  // thông của macOS); đợi một lời gọi IPC sẽ làm thanh công cụ nhảy.
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
